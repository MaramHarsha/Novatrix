import { readFile } from 'node:fs/promises';
import path from 'node:path';

function parseTierAndTools(yaml: string): { tier: string; tools: string[] } {
  const tierM = /^tier:\s*(\S+)/m.exec(yaml);
  const tier = tierM?.[1] ?? 'unknown';
  const tools: string[] = [];
  const re = /^\s*-\s+name:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yaml))) {
    tools.push(m[1].trim());
  }
  return { tier, tools };
}

function parseExegolHint(yaml: string): string | null {
  const line = /^exegol_agent_hint:\s*(.+)$/m.exec(yaml);
  return line?.[1]?.trim() ?? null;
}

/** Human-readable catalog snippet for the system prompt (Neo-style capability awareness). */
export async function loadToolCatalogSummary(manifestPath?: string): Promise<string> {
  const candidates = [
    manifestPath?.trim(),
    process.env.TOOL_MANIFEST_PATH?.trim(),
    path.join(process.cwd(), 'infra', 'docker', 'tools.manifest.yaml'),
    path.join(process.cwd(), '..', '..', 'infra', 'docker', 'tools.manifest.yaml'),
  ].filter((x): x is string => Boolean(x));

  for (const p of candidates) {
    try {
      const raw = await readFile(p, 'utf8');
      const { tier, tools } = parseTierAndTools(raw);
      const exegol = parseExegolHint(raw);
      const tail = exegol ? ` ${exegol}` : '';
      if (!tools.length) return `Tier ${tier} (manifest found but no tools parsed).${tail}`;
      return `Tier ${tier}: ${tools.join(', ')}. Wordlists: mount SecLists read-only when fuzzing (see manifest note).${tail}`;
    } catch {
      /* try next candidate */
    }
  }
  return 'Tool manifest not found; assume common PD CLIs may be installed in the sandbox image.';
}
