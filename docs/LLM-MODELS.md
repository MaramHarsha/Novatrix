# LLM providers and models (Novatrix)

The web app ships on **Next.js 16** (`apps/web`). Novatrix does **not** hardcode every model string. You set **`OPENAI_MODEL`** or **`ANTHROPIC_MODEL`** to whatever your provider accepts. This page lists **common** IDs, **local (Ollama)** setup, and **rate limits** (with official links — limits change over time).

## Browser UI (no `.env` required for keys)

In the web app sidebar under **LLM (browser only)**, choose **OpenAI-compatible** or **Anthropic Claude**, paste API keys and model ids, and click **Save LLM settings to browser**. Values live in `localStorage` and are sent in the `llm` field of each `POST /api/sessions/:id/messages` request. The server merges them over optional env defaults. **Session chat history** (last 60 user/assistant turns from the database) is always passed to the model, so switching provider or model mid-session keeps context; the system prompt also notes that earlier assistant text may come from another model.

Use **HTTPS** in production so keys are not sent in clear text. Do not commit keys to git.

---

## OpenAI and OpenAI-compatible APIs

**Env:** `LLM_PROVIDER=openai` (default), `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` — or omit keys on the server and supply them only from the UI.

Works with:

- **OpenAI** — [Models](https://platform.openai.com/docs/models)
- **Azure OpenAI** — base URL + deployment-specific model names
- **Groq, Together, Fireworks, etc.** — any host exposing an OpenAI-style `/v1/chat/completions` API
- **LiteLLM / vLLM** — same pattern

**Examples** (verify on your account): `gpt-4o-mini`, `gpt-4o`, `gpt-4.1`, `o4-mini`, `o3-mini`, `o3`, `o1`, …

### OpenAI rate limits

Limits depend on **account usage tier** and **model** (RPM, TPM, RPD, etc.). They are **not** the same for every new key.

- Guide: [OpenAI — Rate limits](https://platform.openai.com/docs/guides/rate-limits)
- Your org: [Account limits](https://platform.openai.com/account/limits)

Responses include headers such as `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `retry-after` (when applicable). Novatrix retries **429** and **503** with backoff (see `.env.example` `LLM_*_RETRY`).

---

## Anthropic Claude

**Env:** `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` — or supply keys only from the web UI.

- **Model reference:** [Anthropic — Models overview](https://docs.anthropic.com/en/docs/about-claude/models)

**Examples** (aliases and snapshots change; always check the doc above):

| Family | Example API ids / aliases |
|--------|---------------------------|
| Opus 4.7 | `claude-opus-4-7` |
| Opus 4.6 | `claude-opus-4-6` |
| Opus 4.5 | `claude-opus-4-5`, `claude-opus-4-5-20251101` |
| Sonnet 4.6 | `claude-sonnet-4-6` |
| Sonnet 4.5 | `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929` |
| Haiku 4.5 | `claude-haiku-4-5`, `claude-haiku-4-5-20251001` |
| Legacy 3.5 | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, … |

### Claude API rate limits (new / low tier)

Anthropic publishes **tiered** limits for the Messages API (RPM, input TPM, output TPM). **New organizations** are typically on **Tier 1** until they meet spend thresholds (see Anthropic’s table).

**Illustrative Tier 1 figures** (from Anthropic’s documentation — confirm current values on their site):

- **~50 requests/minute (RPM)** for several Claude 4.x model classes (e.g. Sonnet 4.x, Opus 4.x, Haiku 4.5), with separate **input** and **output** token-per-minute caps.

Higher tiers (after more cumulative spend) raise RPM and TPM substantially.

**Official source (authoritative):** [Anthropic — Rate limits](https://docs.anthropic.com/en/api/rate-limits)

**When you exceed a limit:** HTTP **429** with a body describing which limit was hit. The response may include **`retry-after`** and headers such as `anthropic-ratelimit-requests-*` / `anthropic-ratelimit-tokens-*`.

**HTTP 529 / `overloaded_error`:** This is **not** the same as 429 — it often indicates **temporary provider capacity** for that model/region. Retry with **longer** backoff and avoid tight retry storms.

Novatrix retries **429**, **503**, and **529** with exponential backoff and honors `retry-after` when present (configurable via `LLM_MAX_RETRIES`, `LLM_RETRY_BASE_MS`, `LLM_RETRY_MAX_MS`).

---

## Ollama (local)

Use the **OpenAI-compatible** path:

```env
LLM_PROVIDER=openai
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=llama3.2
```

Install models with `ollama pull <name>`; `OPENAI_MODEL` must match `ollama list`.

- Library: [ollama.com/library](https://ollama.com/library)

---

## Embeddings (memory)

Session memory embeddings still use **`OPENAI_API_KEY`** + **`OPENAI_EMBEDDING_MODEL`** when `OPENAI_API_KEY` is set. If you run **only** Anthropic for chat and omit OpenAI, embedding-based memory retrieval is skipped.

---

## JSON catalog for tools / UI

`GET /api/llm/models` returns curated examples and doc links (`apps/web/src/lib/llmModelCatalog.ts`).
