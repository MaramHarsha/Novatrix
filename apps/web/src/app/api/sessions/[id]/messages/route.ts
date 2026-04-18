import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { runAgentTurn, runAgentTurnAnthropic, type FindingPayload } from '@novatrix/agent';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { ensureSessionWorkspace } from '@/lib/workspacePath';
import { embedText, persistRunSummaryMemory, retrieveMemoryContext } from '@/lib/memory';
import { audit } from '@/lib/audit';
import { writeArtifact } from '@/lib/artifactWriter';
import { enqueuePostRun } from '@/lib/queue';
import { loadToolCatalogSummary } from '@/lib/toolManifest';
import { resolveAllowlistForSession } from '@/lib/sessionAllowlist';
import { assertMutationAuthorized } from '@/lib/mutationAuth';
import { pullDockerImages } from '@/lib/dockerPull';
import {
  buildSandboxProfiles,
  buildSandboxRuntimeHint,
  dockerImagesForProfiles,
  sandboxPullSignature,
  type SandboxEnvSlice,
} from '@/lib/sessionSandbox';
import { parseLlmOverrides, resolveLlmConfig, validateResolvedLlm } from '@/lib/resolveLlmRequest';

export const maxDuration = 300;

/** Load persisted chat messages for UI (refresh / session switch). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, title: true, updatedAt: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  const messages = await prisma.message.findMany({
    where: { sessionId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return NextResponse.json({ session, messages });
}

function parseToolArgs(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  try {
    assertMutationAuthorized(req);
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }
  const body = await req.json();
  const content = typeof body.content === 'string' ? body.content : '';
  const operatorContext =
    typeof body.assessmentContext === 'string' ? body.assessmentContext.trim() : '';
  if (!content.trim()) {
    return new Response(JSON.stringify({ error: 'content required' }), { status: 400 });
  }

  const env = getEnv();
  const llm = resolveLlmConfig(env, parseLlmOverrides(body.llm));
  const llmCheck = validateResolvedLlm(llm);
  if (!llmCheck.ok) {
    return new Response(JSON.stringify({ error: llmCheck.error }), { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return new Response(JSON.stringify({ error: 'session not found' }), { status: 404 });
  }

  const prior = await prisma.message.findMany({
    where: { sessionId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    take: 60,
  });

  await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content,
    },
  });

  const autoTitle =
    (session.title === 'New assessment' || session.title === 'Assessment') && content.trim().length > 0
      ? content.trim().split('\n')[0].trim().slice(0, 80) || session.title
      : null;
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      updatedAt: new Date(),
      ...(autoTitle && autoTitle !== session.title ? { title: autoTitle } : {}),
    },
  });

  const history: ChatCompletionMessageParam[] = prior.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const run = await prisma.run.create({
    data: { sessionId, status: 'running' },
  });

  const workspaceHostPath = await ensureSessionWorkspace(run.id);
  const allowlist = await resolveAllowlistForSession(prisma, sessionId, env.targetAllowlist);
  let toolCatalogSummary = '';
  try {
    toolCatalogSummary = await loadToolCatalogSummary(env.toolManifestPath || undefined);
  } catch {
    toolCatalogSummary = '';
  }

  const openaiForEmbeddings =
    llm.openaiApiKey.length > 0
      ? new OpenAI({
          apiKey: llm.openaiApiKey,
          baseURL: llm.openaiBaseUrl,
        })
      : null;

  let memoryContext = '';
  if (openaiForEmbeddings) {
    try {
      const qEmb = await embedText(openaiForEmbeddings, llm.embeddingModel, content);
      memoryContext = await retrieveMemoryContext(prisma, sessionId, qEmb);
    } catch {
      /* embeddings optional if quota/model missing */
    }
  }

  await audit(prisma, {
    sessionId,
    runId: run.id,
    kind: 'run.start',
    payload: { messagePreview: content.slice(0, 500) },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* stream closed (e.g. client disconnect) while tool/docker still streams */
        }
      };

      try {
        const freshSession =
          (await prisma.session.findUnique({ where: { id: sessionId } })) ?? session;
        const envSlice: SandboxEnvSlice = {
          sandboxMode: env.sandboxMode,
          sandboxImage: env.sandboxImage,
          sandboxDockerNetwork: env.sandboxDockerNetwork,
          sandboxDockerEntrypoint: env.sandboxDockerEntrypoint,
        };
        const sandboxProfiles = buildSandboxProfiles(freshSession, envSlice, workspaceHostPath);
        const network = (
          freshSession.sandboxDockerNetwork?.trim() ||
          env.sandboxDockerNetwork ||
          'none'
        ).trim();
        const pullSig = sandboxPullSignature(sandboxProfiles, network);

        if (env.sandboxMode === 'docker') {
          const images = dockerImagesForProfiles(sandboxProfiles);
          if (images.length && freshSession.sandboxPullSignature !== pullSig) {
            send({ type: 'sandbox_pull', status: 'started', images });
            const results = await pullDockerImages(images);
            const allOk = results.every((r) => r.ok);
            send({ type: 'sandbox_pull', status: allOk ? 'complete' : 'partial', results });
            if (allOk) {
              await prisma.session.update({
                where: { id: sessionId },
                data: { sandboxPullSignature: pullSig },
              });
            }
          }
        }

        const sandboxRuntimeHint = buildSandboxRuntimeHint(sandboxProfiles);

        const llmRetry = {
          maxRetries: env.llmMaxRetries,
          baseDelayMs: env.llmRetryBaseMs,
          maxDelayMs: env.llmRetryMaxMs,
        };

        const onTool = async (name: string, args: string, toolResult: string) => {
          send({ type: 'tool', name, args, result: toolResult.slice(0, 12000) });
          await audit(prisma, {
            sessionId,
            runId: run.id,
            kind: `tool:${name}`,
            payload: { argsPreview: args.slice(0, 2000) },
          });

          if (name === 'http_request') {
            const a = parseToolArgs(args);
            const method = String(a.method ?? '');
            const url = String(a.url ?? '');
            const statusMatch = toolResult.match(/^status (\d+)/);
            send({
              type: 'api',
              method,
              url,
              preview: toolResult.slice(0, 4000),
            });
            send({
              type: 'network',
              line: `${method} ${url} → ${statusMatch?.[1] ?? 'n/a'}`,
            });
          }

          if (name === 'terminal_exec' && toolResult.length > 0) {
            try {
              await writeArtifact(
                prisma,
                run.id,
                workspaceHostPath,
                'terminal',
                `terminal-${Date.now()}.txt`,
                toolResult
              );
            } catch {
              /* ignore artifact errors */
            }
          }

          if (name === 'browser_navigate' && toolResult.length > 0) {
            try {
              await writeArtifact(
                prisma,
                run.id,
                workspaceHostPath,
                'browser',
                `browser-${Date.now()}.txt`,
                toolResult
              );
              send({ type: 'browser', preview: toolResult.slice(0, 4000) });
            } catch {
              /* ignore */
            }
          }
        };

        const onFinding = async (f: FindingPayload) => {
          await prisma.finding.create({
            data: {
              runId: run.id,
              title: f.title,
              severity: f.severity,
              description: f.description,
              evidence: f.evidence,
              payload: f.payload,
            },
          });
          send({ type: 'finding', finding: f });
        };

        const openaiForChat =
          llm.provider === 'openai'
            ? new OpenAI({
                apiKey: llm.openaiApiKey,
                baseURL: llm.openaiBaseUrl,
              })
            : null;

        const result =
          llm.provider === 'anthropic'
            ? await runAgentTurnAnthropic({
                anthropicApiKey: llm.anthropicApiKey,
                model: llm.anthropicModel,
                sandboxProfiles,
                allowlist,
                userMessage: content,
                history,
                memoryContext: memoryContext || undefined,
                operatorContext: operatorContext || undefined,
                toolCatalogSummary: toolCatalogSummary || undefined,
                sandboxRuntimeHint,
                onDelta: (text) => send({ type: 'delta', text }),
                onToolStream: (name, chunk, stream) => {
                  send({ type: 'tool_stream', name, stream, chunk });
                },
                onTool,
                onFinding,
                llmRetry,
              })
            : await runAgentTurn({
                openai: openaiForChat!,
                model: llm.openaiModel,
                sandboxProfiles,
                allowlist,
                userMessage: content,
                history,
                memoryContext: memoryContext || undefined,
                operatorContext: operatorContext || undefined,
                toolCatalogSummary: toolCatalogSummary || undefined,
                sandboxRuntimeHint,
                onDelta: (text) => send({ type: 'delta', text }),
                onToolStream: (name, chunk, stream) => {
                  send({ type: 'tool_stream', name, stream, chunk });
                },
                onTool,
                onFinding,
                llmRetry,
              });

        await prisma.message.create({
          data: {
            sessionId,
            role: 'assistant',
            content: result.assistantVisible || '(no text output)',
          },
        });

        await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'completed',
            summary: result.assistantVisible.slice(0, 500),
            completedAt: new Date(),
          },
        });

        if (openaiForEmbeddings) {
          try {
            await persistRunSummaryMemory(
              prisma,
              openaiForEmbeddings,
              llm.embeddingModel,
              sessionId,
              result.assistantVisible
            );
          } catch {
            /* optional */
          }
        }

        await audit(prisma, { sessionId, runId: run.id, kind: 'run.complete', payload: {} });
        await enqueuePostRun(run.id);
        send({ type: 'done', runId: run.id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await prisma.run.update({
          where: { id: run.id },
          data: { status: 'failed', error: message, completedAt: new Date() },
        });
        await audit(prisma, {
          sessionId,
          runId: run.id,
          kind: 'run.error',
          payload: { message },
        });
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
