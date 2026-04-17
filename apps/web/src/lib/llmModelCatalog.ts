/**
 * Curated model hints for Novatrix UI / operators. Official catalogs change often — always verify IDs in provider docs.
 * You can set OPENAI_MODEL / ANTHROPIC_MODEL to **any** string your account and endpoint support.
 */

export const LLM_MODEL_CATALOG = {
  lastUpdated: '2026-04-18',
  openaiDocs: 'https://platform.openai.com/docs/models',
  anthropicDocs: 'https://docs.anthropic.com/en/docs/about-claude/models',
  ollamaDocs: 'https://ollama.com/library',
  rateLimitsAnthropic: 'https://docs.anthropic.com/en/api/rate-limits',
  rateLimitsOpenai: 'https://platform.openai.com/docs/guides/rate-limits',
  providers: [
    {
      id: 'openai',
      name: 'OpenAI-compatible',
      env: {
        LLM_PROVIDER: 'openai',
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_MODEL: '(see examples)',
      },
      examples: [
        'gpt-4o-mini',
        'gpt-4o',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'o4-mini',
        'o3-mini',
        'o3',
        'o1',
        'chatgpt-4o-latest',
      ],
      note: 'Also works with Groq, Azure OpenAI, LiteLLM, vLLM, etc. — set OPENAI_BASE_URL and OPENAI_API_KEY to match that provider.',
    },
    {
      id: 'ollama',
      name: 'Ollama (local, OpenAI-compatible API)',
      env: {
        LLM_PROVIDER: 'openai',
        OPENAI_BASE_URL: 'http://127.0.0.1:11434/v1',
        OPENAI_API_KEY: 'ollama',
        OPENAI_MODEL: '(name from `ollama list`, e.g. llama3.2)',
      },
      examples: ['llama3.2', 'llama3.1', 'mistral', 'mixtral', 'qwen2.5', 'deepseek-r1', 'codellama'],
      note: 'Run `ollama serve`, then `ollama pull <model>`. Model id must match what `ollama list` shows.',
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude (Messages API)',
      env: {
        LLM_PROVIDER: 'anthropic',
        ANTHROPIC_MODEL: '(see examples)',
      },
      examples: [
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-opus-4-5-20251101',
        'claude-opus-4-5',
        'claude-sonnet-4-6',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-5',
        'claude-haiku-4-5-20251001',
        'claude-haiku-4-5',
        'claude-3-5-haiku-20241022',
        'claude-3-5-sonnet-20241022',
      ],
      note: 'Anthropic publishes aliases and dated snapshot IDs; see anthropicDocs. Use the exact id shown in the console for your account.',
    },
  ],
} as const;
