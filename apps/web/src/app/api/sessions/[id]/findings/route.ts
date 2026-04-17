import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** Evidence-backed findings for a session (aggregated from recent runs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const findings = await prisma.finding.findMany({
    where: { run: { sessionId } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { run: { select: { id: true, startedAt: true, status: true } } },
  });
  return NextResponse.json(findings);
}
