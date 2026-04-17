import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSessionWorkspace } from '@/lib/workspacePath';

/** Create a run + workspace (Neo-style POST /runs primitive). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  const run = await prisma.run.create({
    data: { sessionId, status: 'pending' },
  });
  const workspaceHostPath = await ensureSessionWorkspace(run.id);

  return NextResponse.json({
    runId: run.id,
    workspaceHostPath,
    status: run.status,
  });
}
