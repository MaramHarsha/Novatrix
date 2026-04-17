import { getEnv } from '@/lib/env';

/** When MUTATION_API_KEY is set, require matching `x-api-key` header for state-changing routes. */
export function assertMutationAuthorized(req: Request): void {
  const key = getEnv().mutationApiKey;
  if (!key) return;
  const got = req.headers.get('x-api-key');
  if (got !== key) {
    throw new Error('unauthorized');
  }
}
