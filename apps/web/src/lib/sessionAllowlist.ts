import type { PrismaClient } from '@prisma/client';

/**
 * Merge global env allowlist with session target URL pattern (Neo-style scoped objectives).
 */
export async function resolveAllowlistForSession(
  prisma: PrismaClient,
  sessionId: string,
  envAllowlist: string[]
): Promise<string[]> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { target: true },
  });
  const fromTarget = session?.target?.urlPattern?.trim();
  const merged = [...envAllowlist.map((s) => s.trim()).filter(Boolean)];
  if (fromTarget && !merged.includes(fromTarget)) {
    merged.unshift(fromTarget);
  }
  return merged;
}
