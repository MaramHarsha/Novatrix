import { runTerminal, type SandboxConfig } from '@novatrix/sandbox';
import { isUrlAllowed } from './allowlist';
import { buildBrowserCaptureCommand, workspaceReadFile, workspaceWriteFile } from './fileWorkspace';

export interface FindingPayload {
  title: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  description: string;
  evidence?: string;
  payload?: string;
}

export type SandboxProfiles = {
  novatrix: SandboxConfig | null;
  exegol: SandboxConfig | null;
};

function pickTerminalSandbox(
  profiles: SandboxProfiles,
  profile: string
): SandboxConfig | null {
  const p = profile.toLowerCase() === 'exegol' ? 'exegol' : 'novatrix';
  return p === 'exegol' ? profiles.exegol : profiles.novatrix;
}

function pickBrowserSandbox(profiles: SandboxProfiles): SandboxConfig | null {
  return profiles.novatrix ?? profiles.exegol;
}

export interface DispatchToolOptions {
  sandboxProfiles: SandboxProfiles;
  allowlist: string[];
  workspaceHostPath: string;
  onToolStream?: (name: string, chunk: string, stream: 'stdout' | 'stderr') => void;
  onFinding?: (finding: FindingPayload) => void;
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function dispatchTool(
  name: string,
  argsRaw: string,
  opts: DispatchToolOptions
): Promise<string> {
  const root = opts.workspaceHostPath;
  let result = '';

  if (name === 'terminal_exec') {
    const args = safeJsonParse(argsRaw);
    const command = String(args.command ?? '');
    const profileArg = String(args.sandbox_profile ?? args.sandboxProfile ?? 'novatrix');
    const sandbox = pickTerminalSandbox(opts.sandboxProfiles, profileArg);
    if (!command.trim()) {
      result = 'error: empty command';
    } else if (!sandbox) {
      result = `error: sandbox profile "${profileArg}" is disabled for this session`;
    } else {
      try {
        let sawStream = false;
        const out = await runTerminal(sandbox, {
          command,
          timeoutMs: 180_000,
          onStream: (chunk, stream) => {
            sawStream = true;
            opts.onToolStream?.('terminal_exec', chunk, stream);
          },
        });
        const combined = `${out.stdout}\n--- stderr ---\n${out.stderr}`;
        if (sawStream) {
          const tail = combined.length > 12_000 ? combined.slice(-12_000) : combined;
          result = `exit ${out.exitCode}\n(full output was streamed live; tail for model context)\n${tail}`;
        } else {
          result = `exit ${out.exitCode}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}`;
        }
      } catch (e) {
        result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } else if (name === 'http_request') {
    const args = safeJsonParse(argsRaw);
    const method = String(args.method ?? 'GET').toUpperCase();
    const url = String(args.url ?? '');
    if (!opts.allowlist.length || !isUrlAllowed(url, opts.allowlist)) {
      result = `error: URL not in allowlist: ${url}`;
    } else {
      try {
        const headers: Record<string, string> = args.headers
          ? (JSON.parse(String(args.headers)) as Record<string, string>)
          : {};
        const init: RequestInit = { method, headers };
        if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          init.body = String(args.body);
        }
        const res = await fetch(url, init);
        const text = await res.text();
        const snippet = text.slice(0, 8000);
        result = `status ${res.status}\nheaders: ${JSON.stringify(Object.fromEntries(res.headers))}\nbody (truncated):\n${snippet}`;
      } catch (e) {
        result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } else if (name === 'browser_navigate') {
    const args = safeJsonParse(argsRaw);
    const url = String(args.url ?? '');
    if (!opts.allowlist.length || !isUrlAllowed(url, opts.allowlist)) {
      result = `error: URL not in allowlist: ${url}`;
    } else {
      const browserSandbox = pickBrowserSandbox(opts.sandboxProfiles);
      if (!browserSandbox) {
        result = 'error: no sandbox profile available for browser_navigate';
      } else {
        try {
          const cmd = buildBrowserCaptureCommand(url, browserSandbox.mode);
          let sawStream = false;
          const out = await runTerminal(browserSandbox, {
            command: cmd,
            timeoutMs: 120_000,
            onStream: (chunk, stream) => {
              sawStream = true;
              opts.onToolStream?.('browser_navigate', chunk, stream);
            },
          });
          const combined = `${out.stdout}\n${out.stderr}`;
          result = sawStream
            ? `exit ${out.exitCode}\n(streamed)\n${combined.slice(-8000)}`
            : `exit ${out.exitCode}\n--- stdout ---\n${out.stdout}\n--- stderr ---\n${out.stderr}`;
        } catch (e) {
          result = `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }
  } else if (name === 'file_read') {
    const args = safeJsonParse(argsRaw);
    const p = String(args.path ?? '');
    try {
      result = await workspaceReadFile(root, p);
    } catch (e) {
      result = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else if (name === 'file_write') {
    const args = safeJsonParse(argsRaw);
    const p = String(args.path ?? '');
    const content = String(args.content ?? '');
    try {
      await workspaceWriteFile(root, p, content);
      result = `wrote ${p} (${content.length} chars)`;
    } catch (e) {
      result = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else if (name === 'record_finding') {
    const args = safeJsonParse(argsRaw);
    const rawSev = String(args.severity ?? 'medium');
    const severity: FindingPayload['severity'] = ['info', 'low', 'medium', 'high', 'critical'].includes(rawSev)
      ? (rawSev as FindingPayload['severity'])
      : 'medium';
    const finding: FindingPayload = {
      title: String(args.title ?? 'Finding'),
      severity,
      description: String(args.description ?? ''),
      evidence: args.evidence ? String(args.evidence) : undefined,
      payload: args.payload ? String(args.payload) : undefined,
    };
    opts.onFinding?.(finding);
    result = `Finding recorded: ${finding.title} (${finding.severity})`;
  } else {
    result = `unknown tool ${name}`;
  }

  return result;
}
