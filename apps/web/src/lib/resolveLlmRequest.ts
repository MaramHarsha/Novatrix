import type { LlmProvider } from '@/lib/env';
import { getEnv } from '@/lib/env';

export type LlmRequestOverrides = {
  provider?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  embeddingModel?: string;
};

export type ResolvedLlm = {
  provider: LlmProvider;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  embeddingModel: string;
};

export function parseLlmOverrides(raw: unknown): LlmRequestOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    provider: s(o.provider),
    openaiApiKey: s(o.openaiApiKey),
    openaiBaseUrl: s(o.openaiBaseUrl),
    openaiModel: s(o.openaiModel),
    anthropicApiKey: s(o.anthropicApiKey),
    anthropicModel: s(o.anthropicModel),
    embeddingModel: s(o.embeddingModel),
  };
}

/** Request body overrides win over process env (empty override string falls back to env). */
export function resolveLlmConfig(
  env: ReturnType<typeof getEnv>,
  overrides: LlmRequestOverrides | undefined
): ResolvedLlm {
  const o = overrides ?? {};
  const providerRaw = (o.provider ?? env.llmProvider).toString().toLowerCase();
  const provider: LlmProvider = providerRaw === 'anthropic' ? 'anthropic' : 'openai';
  return {
    provider,
    openaiApiKey: (o.openaiApiKey !== undefined ? o.openaiApiKey : env.openaiApiKey).trim(),
    openaiBaseUrl: (o.openaiBaseUrl !== undefined ? o.openaiBaseUrl : env.openaiBaseUrl).trim() || 'https://api.openai.com/v1',
    openaiModel: (o.openaiModel !== undefined ? o.openaiModel : env.openaiModel).trim() || 'gpt-4o-mini',
    anthropicApiKey: (o.anthropicApiKey !== undefined ? o.anthropicApiKey : env.anthropicApiKey).trim(),
    anthropicModel: (o.anthropicModel !== undefined ? o.anthropicModel : env.anthropicModel).trim() || 'claude-opus-4-6',
    embeddingModel: (o.embeddingModel !== undefined ? o.embeddingModel : env.embeddingModel).trim() || 'text-embedding-3-small',
  };
}

export function validateResolvedLlm(llm: ResolvedLlm): { ok: true } | { ok: false; error: string } {
  if (llm.provider === 'anthropic') {
    if (!llm.anthropicApiKey) {
      return {
        ok: false,
        error:
          'Anthropic API key missing: set it in the LLM panel (saved in the browser) or set ANTHROPIC_API_KEY on the server.',
      };
    }
  } else if (!llm.openaiApiKey) {
    return {
      ok: false,
      error:
        'OpenAI-compatible API key missing: set it in the LLM panel (saved in the browser) or set OPENAI_API_KEY on the server.',
    };
  }
  return { ok: true };
}
