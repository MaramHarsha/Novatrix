import path from 'node:path';
import { mkdir } from 'node:fs/promises';

export async function ensureSessionWorkspace(runId: string): Promise<string> {
  const base = process.env.ARTIFACTS_DIR ?? path.join(process.cwd(), '..', '..', 'artifacts');
  const dir = path.join(base, 'runs', runId);
  await mkdir(dir, { recursive: true });
  return dir;
}
