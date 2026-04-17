import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

export type SandboxMode = 'docker' | 'mock';

export interface TerminalExecOptions {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Stream stdout/stderr chunks as they arrive (Neo-style live logs). */
  onStream?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

export interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxConfig {
  mode: SandboxMode;
  image: string;
  /** Host path mounted at /workspace in container */
  workspaceHostPath: string;
  /**
   * Docker network mode: `none` blocks outbound (except explicit links), `bridge` allows egress.
   * Matches Neo sandbox isolation narrative; override for lab scans needing DNS/HTTP.
   */
  dockerNetwork?: string;
}

function collectStreamedSpawn(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; onStream?: TerminalExecOptions['onStream'] }
): Promise<TerminalExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: opts.cwd,
      env: opts.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timeout after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout?.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      opts.onStream?.(s, 'stdout');
    });
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStream?.(s, 'stderr');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Run command inside Docker container with workspace bind-mount (docker CLI).
 */
export async function terminalExecDocker(
  cfg: SandboxConfig,
  opts: TerminalExecOptions
): Promise<TerminalExecResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const network = cfg.dockerNetwork ?? 'none';
  const dockerArgs = [
    'run',
    '--rm',
    ...(network && network !== 'default' ? ['--network', network] : []),
    '-v',
    `${cfg.workspaceHostPath}:/workspace`,
    '-w',
    '/workspace',
    '-e',
    `PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin`,
    cfg.image,
    '/bin/bash',
    '-lc',
    opts.command,
  ];
  const env = { ...process.env, ...opts.env } as NodeJS.ProcessEnv;
  return collectStreamedSpawn('docker', dockerArgs, { env, timeoutMs, onStream: opts.onStream });
}

/**
 * Mock sandbox: runs shell command in workspace directory (dev only — not isolated).
 */
export async function terminalExecMock(
  workspaceDir: string,
  opts: TerminalExecOptions
): Promise<TerminalExecResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  await mkdir(workspaceDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, {
      shell: true,
      cwd: opts.cwd ?? workspaceDir,
      env: { ...process.env, ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`mock sandbox timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      opts.onStream?.(s, 'stdout');
    });
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStream?.(s, 'stderr');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export async function runTerminal(
  cfg: SandboxConfig,
  opts: TerminalExecOptions
): Promise<TerminalExecResult> {
  if (cfg.mode === 'mock') {
    return terminalExecMock(cfg.workspaceHostPath, opts);
  }
  return terminalExecDocker(cfg, opts);
}
