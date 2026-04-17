import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { runTerminal, type SandboxConfig } from '@novatrix/sandbox';
import { SYSTEM_PROMPT } from './systemPrompt';
import { tools } from './tools';
import { isUrlAllowed } from './allowlist';
import { buildBrowserCaptureCommand, workspaceReadFile, workspaceWriteFile } from './fileWorkspace';

export interface FindingPayload {
  title: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence?: string;
  payload?: string;
}

export interface RunAgentOptions {
  openai: OpenAI;
  model: string;
  sandbox: SandboxConfig;
  allowlist: string[];
  userMessage: string;
  history: ChatCompletionMessageParam[];
  /** Retrieved memory / context (Neo Memory doc). */
  memoryContext?: string;
  /** Short summary of bundled CLI tools (from tools.manifest.yaml). */
  toolCatalogSummary?: string;
  maxIterations?: number;
  onDelta?: (text: string) => void;
  onTool?: (name: string, args: string, result: string) => void;
  /** Live terminal/stderr chunks while terminal_exec runs (Neo sandbox streaming). */
  onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
  onFinding?: (finding: FindingPayload) => void;
}

export interface RunAgentResult {
  messages: ChatCompletionMessageParam[];
  assistantVisible: string;
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runAgentTurn(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxIterations = opts.maxIterations ?? 12;
  let systemContent = SYSTEM_PROMPT;
  if (opts.toolCatalogSummary?.trim()) {
    systemContent += `\n\n## Installed sandbox tools (manifest)\n${opts.toolCatalogSummary.trim()}`;
  }
  if (opts.memoryContext?.trim()) {
    systemContent += `\n\n## Session memory (retrieved)\n${opts.memoryContext.trim()}`;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...opts.history,
    {
      role: 'user',
      content: `${opts.userMessage}\n\nAllowed URL prefixes for this run: ${opts.allowlist.join(', ') || '(none — refuse outbound http_request / browser_navigate)'}`,
    },
  ];

  let assistantVisible = '';
  const root = opts.sandbox.workspaceHostPath;

  for (let i = 0; i < maxIterations; i++) {
    const completion = await opts.openai.chat.completions.create({
      model: opts.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
    });

    const choice = completion.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    if (msg.content) {
      assistantVisible += msg.content;
      opts.onDelta?.(msg.content);
    }

    const toolCalls = msg.tool_calls;
    if (!toolCalls?.length) {
      messages.push({ role: 'assistant', content: msg.content ?? null });
      break;
    }

    messages.push({
      role: 'assistant',
      content: msg.content ?? null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const name = tc.function.name;
      const argsRaw = tc.function.arguments ?? '{}';
      let result = '';

      if (name === 'terminal_exec') {
        const args = safeJsonParse(argsRaw);
        const command = String(args.command ?? '');
        if (!command.trim()) {
          result = 'error: empty command';
        } else {
          try {
            let sawStream = false;
            const out = await runTerminal(opts.sandbox, {
              command,
              timeoutMs: 180_000,
              onStream: (chunk, stream) => {
                sawStream = true;
                opts.onToolStream?.('terminal_exec', chunk, stream);
              },
            });
            const combined = `${out.stdout}\n--- stderr ---\n${out.stderr}`;
            if (sawStream) {
              const tail = combined.length > 12_000 ? combined.slice(-12_000) : combined;
              result = `exit ${out.exitCode}\n(full output was streamed live; tail for model context)\n${tail}`;
            } else {
              result = `exit ${out.exitCode}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}`;
            }
          } catch (e) {
            result = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      } else if (name === 'http_request') {
        const args = safeJsonParse(argsRaw);
        const method = String(args.method ?? 'GET').toUpperCase();
        const url = String(args.url ?? '');
        if (!opts.allowlist.length || !isUrlAllowed(url, opts.allowlist)) {
          result = `error: URL not in allowlist: ${url}`;
        } else {
          try {
            const headers: Record<string, string> = args.headers
              ? (JSON.parse(String(args.headers)) as Record<string, string>)
              : {};
            const init: RequestInit = { method, headers };
            if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
              init.body = String(args.body);
            }
            const res = await fetch(url, init);
            const text = await res.text();
            const snippet = text.slice(0, 8000);
            result = `status ${res.status}\nheaders: ${JSON.stringify(Object.fromEntries(res.headers))}\nbody (truncated):\n${snippet}`;
          } catch (e) {
            result = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      } else if (name === 'browser_navigate') {
        const args = safeJsonParse(argsRaw);
        const url = String(args.url ?? '');
        if (!opts.allowlist.length || !isUrlAllowed(url, opts.allowlist)) {
          result = `error: URL not in allowlist: ${url}`;
        } else {
          try {
            const cmd = buildBrowserCaptureCommand(url, opts.sandbox.mode);
            let sawStream = false;
            const out = await runTerminal(opts.sandbox, {
              command: cmd,
              timeoutMs: 120_000,
              onStream: (chunk, stream) => {
                sawStream = true;
                opts.onToolStream?.('browser_navigate', chunk, stream);
              },
            });
            const combined = `${out.stdout}\n${out.stderr}`;
            result = sawStream
              ? `exit ${out.exitCode}\n(streamed)\n${combined.slice(-8000)}`
              : `exit ${out.exitCode}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}`;
          } catch (e) {
            result = `error: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      } else if (name === 'file_read') {
        const args = safeJsonParse(argsRaw);
        const p = String(args.path ?? '');
        try {
          result = await workspaceReadFile(root, p);
        } catch (e) {
          result = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else if (name === 'file_write') {
        const args = safeJsonParse(argsRaw);
        const p = String(args.path ?? '');
        const content = String(args.content ?? '');
        try {
          await workspaceWriteFile(root, p, content);
          result = `wrote ${p} (${content.length} chars)`;
        } catch (e) {
          result = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else if (name === 'record_finding') {
        const args = safeJsonParse(argsRaw);
        const rawSev = String(args.severity ?? 'medium');
        const severity: FindingPayload['severity'] = [
          'info',
          'low',
          'medium',
          'high',
          'critical',
        ].includes(rawSev)
          ? (rawSev as FindingPayload['severity'])
          : 'medium';
        const finding: FindingPayload = {
          title: String(args.title ?? 'Finding'),
          severity,
          description: String(args.description ?? ''),
          evidence: args.evidence ? String(args.evidence) : undefined,
          payload: args.payload ? String(args.payload) : undefined,
        };
        opts.onFinding?.(finding);
        result = `Finding recorded: ${finding.title} (${finding.severity})`;
      } else {
        result = `unknown tool ${name}`;
      }

      opts.onTool?.(name, argsRaw, result);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return { messages, assistantVisible };
}
