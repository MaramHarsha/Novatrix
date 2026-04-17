import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { tools } from './tools';
import { SYSTEM_PROMPT } from './systemPrompt';
import { dispatchTool, type FindingPayload, type SandboxProfiles } from './dispatchTool';
import { withLlmRetry, type LlmRetryOptions } from './llmRetry';

const anthropicTools: Tool[] = tools.map((t) => ({
  name: t.function.name,
  description: t.function.description ?? '',
  input_schema: t.function.parameters as Tool['input_schema'],
}));

function normalizeHistory(history: ChatCompletionMessageParam[]): MessageParam[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const c = m.content;
      const text = typeof c === 'string' ? c : c == null ? '' : JSON.stringify(c);
      return { role: m.role as 'user' | 'assistant', content: text };
    });
}

export interface RunAgentAnthropicOptions {
  anthropicApiKey: string;
  model: string;
  sandboxProfiles: SandboxProfiles;
  allowlist: string[];
  userMessage: string;
  history: ChatCompletionMessageParam[];
  memoryContext?: string;
  toolCatalogSummary?: string;
  sandboxRuntimeHint?: string;
  maxIterations?: number;
  onDelta?: (text: string) => void;
  onTool?: (name: string, args: string, result: string) => void;
  onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
  onFinding?: (finding: FindingPayload) => void;
  /** Backoff for Anthropic 429/529/503 (optional). */
  llmRetry?: Partial<LlmRetryOptions>;
}

export interface RunAgentAnthropicResult {
  assistantVisible: string;
}

export async function runAgentTurnAnthropic(opts: RunAgentAnthropicOptions): Promise<RunAgentAnthropicResult> {
  const anthropic = new Anthropic({ apiKey: opts.anthropicApiKey });
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
  if (opts.history.length) {
    systemContent +=
      '\n\n## Continuity\nEarlier turns in the conversation may have been produced by another model or provider. Treat the transcript as ground truth and stay consistent with recorded findings and scope.';
  }

  const messages: MessageParam[] = [
    ...normalizeHistory(opts.history),
    {
      role: 'user',
      content: `${opts.userMessage}\n\nAllowed URL prefixes for this run: ${opts.allowlist.join(', ') || '(none — refuse outbound http_request / browser_navigate)'}`,
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
    const response = await withLlmRetry(
      async () => {
        const stream = anthropic.messages.stream({
          model: opts.model,
          max_tokens: 24_576,
          system: systemContent,
          tools: anthropicTools,
          messages,
          temperature: 0.2,
        });

        stream.on('text', (text) => {
          assistantVisible += text;
          opts.onDelta?.(text);
        });

        return stream.finalMessage();
      },
      opts.llmRetry
    );

    if (response.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResultBlocks: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const argsRaw = JSON.stringify(block.input ?? {});
        const result = await dispatchTool(block.name, argsRaw, toolCtxBase);
        opts.onTool?.(block.name, argsRaw, result);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    if (!toolResultBlocks.length) {
      break;
    }

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  return { assistantVisible };
}
