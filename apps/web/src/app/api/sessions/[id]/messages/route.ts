import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { runAgentTurn } from '@novatrix/agent';
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

export const maxDuration = 300;

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
  if (!content.trim()) {
    return new Response(JSON.stringify({ error: 'content required' }), { status: 400 });
  }

  const env = getEnv();
  if (!env.openaiApiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not set' }), { status: 500 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return new Response(JSON.stringify({ error: 'session not found' }), { status: 404 });
  }

  const prior = await prisma.message.findMany({
    where: { sessionId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    take: 40,
  });

  await prisma.message.create({
    data: {
      sessionId,
      role: 'user',
      content,
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

  const openai = new OpenAI({
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl,
  });

  let memoryContext = '';
  try {
    const qEmb = await embedText(openai, env.embeddingModel, content);
    memoryContext = await retrieveMemoryContext(prisma, sessionId, qEmb);
  } catch {
    /* embeddings optional if quota/model missing */
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
      const send = (obj: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const result = await runAgentTurn({
          openai,
          model: env.openaiModel,
          sandbox: {
            mode: env.sandboxMode,
            image: env.sandboxImage,
            workspaceHostPath,
            dockerNetwork: env.sandboxMode === 'docker' ? env.sandboxDockerNetwork : undefined,
          },
          allowlist,
          userMessage: content,
          history,
          memoryContext: memoryContext || undefined,
          toolCatalogSummary: toolCatalogSummary || undefined,
          onDelta: (text) => send({ type: 'delta', text }),
          onToolStream: (name, chunk, stream) => {
            send({ type: 'tool_stream', name, stream, chunk });
          },
          onTool: async (name, args, toolResult) => {
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
          },
          onFinding: async (f) => {
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
          },
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

        try {
          await persistRunSummaryMemory(
            prisma,
            openai,
            env.embeddingModel,
            sessionId,
            result.assistantVisible
          );
        } catch {
          /* optional */
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
