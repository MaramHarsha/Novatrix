import { spawn } from 'node:child_process';

export interface DockerPullResult {
  image: string;
  ok: boolean;
  error?: string;
}

export async function pullDockerImage(
  image: string,
  opts?: { timeoutMs?: number }
): Promise<{ ok: boolean; stderr: string }> {
  const timeoutMs = opts?.timeoutMs ?? 900_000;
  return new Promise((resolve) => {
    const child = spawn('docker', ['pull', image], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.stdout?.on('data', (d) => {
      stderr += d.toString();
    });
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, stderr: `${stderr}\n(pull timeout after ${timeoutMs}ms)` });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ ok: false, stderr: `${stderr}\n${e instanceof Error ? e.message : String(e)}` });
    });
  });
}

export async function pullDockerImages(images: string[]): Promise<DockerPullResult[]> {
  const uniq = [...new Set(images.map((i) => i.trim()).filter(Boolean))];
  const out: DockerPullResult[] = [];
  for (const image of uniq) {
    const r = await pullDockerImage(image);
    out.push({ image, ok: r.ok, error: r.ok ? undefined : r.stderr.slice(-4000) });
  }
  return out;
}
