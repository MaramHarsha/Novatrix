import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      target: true,
      project: true,
      runs: { orderBy: { startedAt: 'desc' }, take: 10, select: { id: true, status: true, startedAt: true } },
    },
  });
  if (!session) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json(session);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title : undefined;
  const targetId =
    typeof body.targetId === 'string'
      ? body.targetId
      : body.targetId === null
        ? null
        : undefined;

  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (targetId) {
    const t = await prisma.target.findUnique({ where: { id: targetId } });
    if (!t) {
      return NextResponse.json({ error: 'target not found' }, { status: 400 });
    }
  }

  const updated = await prisma.session.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(targetId !== undefined ? { targetId: targetId || null } : {}),
    },
    include: { target: true },
  });
  return NextResponse.json(updated);
}
