import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

export async function GET() {
  const rows = await prisma.schedule.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { session: { select: { id: true, title: true } } },
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const cronExpr = typeof body.cronExpr === 'string' ? body.cronExpr : '0 */6 * * *';
  if (!sessionId || !prompt.trim()) {
    return NextResponse.json({ error: 'sessionId and prompt required' }, { status: 400 });
  }
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  const row = await prisma.schedule.create({
    data: { sessionId, prompt, cronExpr },
  });
  return NextResponse.json(row);
}
