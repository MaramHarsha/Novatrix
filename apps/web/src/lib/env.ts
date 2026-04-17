export function getEnv() {
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    redisUrl: process.env.REDIS_URL ?? '',
    sandboxMode: (process.env.SANDBOX_MODE ?? 'mock') as 'docker' | 'mock',
    sandboxImage: process.env.SANDBOX_IMAGE ?? 'novatrix-sandbox:latest',
    /** Docker network for sandbox containers: `none` (default) or `bridge` for outbound scans. */
    sandboxDockerNetwork: process.env.SANDBOX_DOCKER_NETWORK ?? 'none',
    toolManifestPath: process.env.TOOL_MANIFEST_PATH ?? '',
    mutationApiKey: process.env.MUTATION_API_KEY ?? '',
    targetAllowlist: (process.env.TARGET_ALLOWLIST ?? 'http://localhost,https://localhost,http://127.0.0.1,https://127.0.0.1')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
