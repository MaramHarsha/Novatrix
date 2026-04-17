import type { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export async function audit(
  prisma: PrismaClient,
  opts: { sessionId?: string; runId?: string; kind: string; payload?: Record<string, unknown> }
) {
  await prisma.auditLog.create({
    data: {
      sessionId: opts.sessionId,
      runId: opts.runId,
      kind: opts.kind,
      payload: opts.payload as Prisma.InputJsonValue | undefined,
    },
  });
}
