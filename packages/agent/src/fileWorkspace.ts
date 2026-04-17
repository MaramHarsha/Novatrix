import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_READ = 512_000;

export function assertSafeRelativePath(rel: string): void {
  if (!rel || rel.trim() === '') throw new Error('empty path');
  if (path.isAbsolute(rel)) throw new Error('absolute path not allowed');
  const norm = path.normalize(rel);
  if (norm.startsWith('..') || norm.includes(`..${path.sep}`)) throw new Error('path traversal not allowed');
}

function isInsideDir(base: string, full: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(full));
  if (path.isAbsolute(rel)) return false;
  return !rel.startsWith('..');
}

export async function workspaceReadFile(root: string, rel: string): Promise<string> {
  assertSafeRelativePath(rel);
  await mkdir(root, { recursive: true });
  const base = await realpath(root).catch(() => root);
  const full = path.resolve(base, rel);
  if (!isInsideDir(base, full)) throw new Error('path escape');
  const buf = await readFile(full);
  if (buf.length > MAX_READ) return buf.subarray(0, MAX_READ).toString('utf8') + '\n...[truncated]';
  return buf.toString('utf8');
}

export async function workspaceWriteFile(root: string, rel: string, content: string): Promise<void> {
  assertSafeRelativePath(rel);
  await mkdir(root, { recursive: true });
  const base = await realpath(root).catch(() => root);
  const full = path.resolve(base, rel);
  if (!isInsideDir(base, full)) throw new Error('path escape');
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

export function buildBrowserCaptureCommand(url: string, mode: 'docker' | 'mock'): string {
  const u = url.replace(/'/g, `'\\''`);
  if (mode === 'docker') {
    return `mkdir -p browser && chromium --headless --no-sandbox --disable-gpu --window-size=1400,900 --screenshot=browser/snap.png '${u}' 2>&1 && ls -la browser`;
  }
  return `mkdir -p browser && curl -L --max-time 25 -sS -o browser/page.html '${u}' && echo WROTE browser/page.html`;
}
