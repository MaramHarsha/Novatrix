/** Shared backoff for OpenAI / Anthropic transient limits (429) and Anthropic overload (529). */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const o = err as Record<string, unknown>;
  if (typeof o.status === 'number') return o.status;
  const inner = o.error;
  if (inner && typeof inner === 'object' && typeof (inner as Record<string, unknown>).status === 'number') {
    return (inner as Record<string, unknown>).status as number;
  }
  return undefined;
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const headers = (err as { headers?: { get?: (k: string) => string | null } }).headers;
  const raw = headers?.get?.('retry-after');
  if (!raw) return undefined;
  const sec = Number.parseInt(raw, 10);
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 120_000);
  return undefined;
}

function isRetriableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 429 || status === 503 || status === 529;
}

export interface LlmRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const defaultRetry: LlmRetryOptions = {
  maxRetries: 6,
  baseDelayMs: 2000,
  maxDelayMs: 90_000,
};

/**
 * Retries `fn` on 429 / 503 / 529 when the thrown error exposes `status` (OpenAI SDK, Anthropic SDK).
 * Honors `retry-after` response header when present.
 */
export async function withLlmRetry<T>(fn: () => Promise<T>, options?: Partial<LlmRetryOptions>): Promise<T> {
  const o = { ...defaultRetry, ...options };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= o.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = getHttpStatus(e);
      if (!isRetriableStatus(status) || attempt >= o.maxRetries) {
        throw e;
      }
      const fromHeader = getRetryAfterMs(e);
      const exponential = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** attempt);
      const delay = Math.min(o.maxDelayMs, Math.max(fromHeader ?? 0, exponential));
      await sleep(delay);
    }
  }
  throw lastErr;
}
