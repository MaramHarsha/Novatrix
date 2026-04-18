import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { tools } from './tools';
import { SYSTEM_PROMPT } from './systemPrompt';
import { dispatchTool, type FindingPayload, type SandboxProfiles } from './dispatchTool';
import { withLlmRetry, type LlmRetryOptions } from './llmRetry';

export type { FindingPayload };

export interface RunAgentOptions {
  openai: OpenAI;
  model: string;
  sandboxProfiles: SandboxProfiles;
  allowlist: string[];
  userMessage: string;
  history: ChatCompletionMessageParam[];
  /** Retrieved memory / context (Neo Memory doc). */
  memoryContext?: string;
  /** Operator notes: methodology, pasted writeup excerpts, constraints (UI). */
  operatorContext?: string;
  /** Short summary of bundled CLI tools (from tools.manifest.yaml). */
  toolCatalogSummary?: string;
  /** Per-session Novatrix vs Exegol hints for the model. */
  sandboxRuntimeHint?: string;
  maxIterations?: number;
  onDelta?: (text: string) => void;
  onTool?: (name: string, args: string, result: string) => void | Promise<void>;
  /** Live terminal/stderr chunks while terminal_exec runs (Neo sandbox streaming). */
  onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
  onFinding?: (finding: FindingPayload) => void | Promise<void>;
  /** Backoff for OpenAI 429/503 (optional). */
  llmRetry?: Partial<LlmRetryOptions>;
}

export interface RunAgentResult {
  messages: ChatCompletionMessageParam[];
  assistantVisible: string;
}

export async function runAgentTurn(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxIterations = opts.maxIterations ?? 12;
  let systemContent = SYSTEM_PROMPT;
  if (opts.toolCatalogSummary?.trim()) {
    systemContent += `\n\n## Installed sandbox tools (manifest)\n${opts.toolCatalogSummary.trim()}`;
  }
  if (opts.sandboxRuntimeHint?.trim()) {
    systemContent += `\n\n${opts.sandboxRuntimeHint.trim()}`;
  }
  if (opts.memoryContext?.trim()) {
    systemContent += `\n\n## Session memory (retrieved)\n${opts.memoryContext.trim()}`;
  }
  if (opts.operatorContext?.trim()) {
    systemContent += `\n\n## Operator-provided context (methodology, scope notes, writeup excerpts)\n${opts.operatorContext.trim()}`;
  }
  if (opts.history.length) {
    systemContent +=
      '\n\n## Continuity\nEarlier turns in `history` may have been produced by another model or provider. Treat the user/assistant transcript as ground truth and stay consistent with recorded findings and scope.';
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemContent },
    ...opts.history,
    {
      role: 'user',
      content: `${opts.userMessage}\n\nAllowed URL prefixes for this run: ${opts.allowlist.join(', ') || '(none; refuse outbound http_request / browser_navigate unless operator context authorizes)'}`,
    },
  ];

  let assistantVisible = '';
  const toolCtxBase = {
    sandboxProfiles: opts.sandboxProfiles,
    allowlist: opts.allowlist,
    workspaceHostPath:
      opts.sandboxProfiles.novatrix?.workspaceHostPath ?? opts.sandboxProfiles.exegol?.workspaceHostPath ?? '',
    onToolStream: opts.onToolStream,
    onFinding: opts.onFinding,
  };

  for (let i = 0; i < maxIterations; i++) {
    const completion = await withLlmRetry(
      () =>
        opts.openai.chat.completions.create({
          model: opts.model,
          messages,
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
        }),
      opts.llmRetry
    );

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
      const result = await dispatchTool(name, argsRaw, toolCtxBase);
      await Promise.resolve(opts.onTool?.(name, argsRaw, result));
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  return { messages, assistantVisible };
}
