export type LlmProvider = 'openai' | 'anthropic';

export function getEnv() {
  const rawProvider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase();
  const llmProvider: LlmProvider = rawProvider === 'anthropic' ? 'anthropic' : 'openai';

  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    llmProvider,
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    /** Claude API model id (e.g. `claude-opus-4-6` — see Anthropic docs). */
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-6',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    redisUrl: process.env.REDIS_URL ?? '',
    sandboxMode: (process.env.SANDBOX_MODE ?? 'mock') as 'docker' | 'mock',
    sandboxImage: process.env.SANDBOX_IMAGE ?? 'novatrix-sandbox:latest',
    /** Docker network for sandbox containers: `none` (default) or `bridge` for outbound scans. */
    sandboxDockerNetwork: process.env.SANDBOX_DOCKER_NETWORK ?? 'none',
    /**
     * Docker `--entrypoint` override. `bash` = `/bin/bash`. `none`/`off` = use image default + `/bin/bash -lc`.
     * Omit/empty = auto `--entrypoint /bin/bash` when `SANDBOX_IMAGE` matches Exegol.
     */
    sandboxDockerEntrypoint: (() => {
      const v = process.env.SANDBOX_DOCKER_ENTRYPOINT?.trim();
      return v === '' || v === undefined ? undefined : v;
    })(),
    toolManifestPath: process.env.TOOL_MANIFEST_PATH ?? '',
    mutationApiKey: process.env.MUTATION_API_KEY ?? '',
    targetAllowlist: (process.env.TARGET_ALLOWLIST ?? 'http://localhost,https://localhost,http://127.0.0.1,https://127.0.0.1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    /** Retries after HTTP 429/503 (OpenAI) or 429/529/503 (Anthropic). */
    llmMaxRetries: clampInt(process.env.LLM_MAX_RETRIES, 6, 0, 24),
    llmRetryBaseMs: clampInt(process.env.LLM_RETRY_BASE_MS, 2000, 200, 60_000),
    llmRetryMaxMs: clampInt(process.env.LLM_RETRY_MAX_MS, 90_000, 1000, 300_000),
  };
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
