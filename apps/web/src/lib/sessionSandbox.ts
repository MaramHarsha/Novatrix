import type { SandboxConfig } from '@novatrix/sandbox';
import type { Session } from '@prisma/client';

export const DEFAULT_EXEGOL_IMAGE = 'nwodtuhs/exegol:web-3.1.6';

export type SandboxProfiles = {
  novatrix: SandboxConfig | null;
  exegol: SandboxConfig | null;
};

/** Subset of `getEnv()` used when resolving per-session sandbox profiles. */
export type SandboxEnvSlice = {
  sandboxMode: 'docker' | 'mock';
  sandboxImage: string;
  sandboxDockerNetwork: string;
  sandboxDockerEntrypoint?: string;
};

/** Allow Docker Hub / GHCR-style image refs only (no shell metacharacters). */
export function isValidDockerImageRef(s: string): boolean {
  const t = s.trim();
  if (t.length < 3 || t.length > 220) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._/@:-]+$/.test(t);
}

export function buildSandboxProfiles(
  session: Session,
  env: SandboxEnvSlice,
  workspaceHostPath: string
): SandboxProfiles {
  const network = (session.sandboxDockerNetwork?.trim() || env.sandboxDockerNetwork || 'none').trim();

  if (env.sandboxMode !== 'docker') {
    const mock: SandboxConfig = {
      mode: 'mock',
      image: 'mock',
      workspaceHostPath,
    };
    return {
      novatrix: session.sandboxEnableNovatrix !== false ? mock : null,
      exegol: session.sandboxEnableExegol ? mock : null,
    };
  }

  const entry = env.sandboxDockerEntrypoint;

  let novatrix: SandboxConfig | null = null;
  if (session.sandboxEnableNovatrix !== false) {
    const image = (session.sandboxNovatrixImage?.trim() || env.sandboxImage).trim();
    novatrix = {
      mode: 'docker',
      image,
      workspaceHostPath,
      dockerNetwork: network,
      dockerEntrypoint: entry,
    };
  }

  let exegol: SandboxConfig | null = null;
  if (session.sandboxEnableExegol) {
    const image = (session.sandboxExegolImage?.trim() || DEFAULT_EXEGOL_IMAGE).trim();
    exegol = {
      mode: 'docker',
      image,
      workspaceHostPath,
      dockerNetwork: network,
      dockerEntrypoint: entry,
    };
  }

  if (!novatrix && !exegol) {
    novatrix = {
      mode: 'docker',
      image: env.sandboxImage,
      workspaceHostPath,
      dockerNetwork: network,
      dockerEntrypoint: entry,
    };
  }

  return { novatrix, exegol };
}

export function dockerImagesForProfiles(profiles: SandboxProfiles): string[] {
  const out: string[] = [];
  if (profiles.novatrix?.mode === 'docker') out.push(profiles.novatrix.image);
  if (profiles.exegol?.mode === 'docker') out.push(profiles.exegol.image);
  return [...new Set(out)];
}

export function sandboxPullSignature(profiles: SandboxProfiles, network: string): string {
  const imgs = dockerImagesForProfiles(profiles).sort();
  return `${network}|${imgs.join('||')}`;
}

export function buildSandboxRuntimeHint(profiles: SandboxProfiles): string {
  const lines: string[] = [
    '## Sandbox profiles (this session)',
    'For `terminal_exec`, set optional argument `sandbox_profile` to `"novatrix"` or `"exegol"` to choose which container runs the command.',
    'Use **novatrix** for the default Tier-1 ProjectDiscovery-style toolchain (faster, smaller image).',
    'Use **exegol** when you need tools that exist only in the full Exegol image. Cross-check important findings in both when both are enabled.',
  ];
  if (profiles.novatrix) {
    const m = profiles.novatrix.mode;
    lines.push(
      `- **novatrix**: enabled (${m === 'docker' ? `Docker \`${profiles.novatrix.image}\`` : 'mock / local shell'})`
    );
  } else {
    lines.push('- **novatrix**: disabled for this session');
  }
  if (profiles.exegol) {
    const m = profiles.exegol.mode;
    lines.push(
      `- **exegol**: enabled (${m === 'docker' ? `Docker \`${profiles.exegol.image}\`` : 'mock / local shell'})`
    );
  } else {
    lines.push('- **exegol**: disabled (enable in Sandbox settings to use the large toolset)');
  }
  return lines.join('\n');
}
