/** Returns true if url starts with any allowed prefix */
export function isUrlAllowed(url: string, allowlist: string[]): boolean {
  try {
    const u = new URL(url);
    const normalized = `${u.protocol}//${u.host}${u.port ? `:${u.port}` : ''}`;
    const full = u.href.split('?')[0] ?? u.href;
    return allowlist.some((prefix) => {
      const p = prefix.trim().replace(/\/$/, '');
      return full.startsWith(p) || normalized.startsWith(p);
    });
  } catch {
    return false;
  }
}
