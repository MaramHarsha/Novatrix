import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertMutationAuthorized } from '@/lib/mutationAuth';
import { isValidDockerImageRef } from '@/lib/sessionSandbox';

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

  const sandboxNovatrixImage =
    typeof body.sandboxNovatrixImage === 'string'
      ? body.sandboxNovatrixImage.trim() || null
      : body.sandboxNovatrixImage === null
        ? null
        : undefined;
  const sandboxExegolImage =
    typeof body.sandboxExegolImage === 'string'
      ? body.sandboxExegolImage.trim() || null
      : body.sandboxExegolImage === null
        ? null
        : undefined;
  const sandboxDockerNetwork =
    body.sandboxDockerNetwork === null
      ? null
      : typeof body.sandboxDockerNetwork === 'string'
        ? body.sandboxDockerNetwork.trim() || null
        : undefined;
  const sandboxEnableNovatrix =
    typeof body.sandboxEnableNovatrix === 'boolean' ? body.sandboxEnableNovatrix : undefined;
  const sandboxEnableExegol =
    typeof body.sandboxEnableExegol === 'boolean' ? body.sandboxEnableExegol : undefined;

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

  if (sandboxNovatrixImage !== undefined && sandboxNovatrixImage !== null && !isValidDockerImageRef(sandboxNovatrixImage)) {
    return NextResponse.json({ error: 'invalid sandboxNovatrixImage' }, { status: 400 });
  }
  if (sandboxExegolImage !== undefined && sandboxExegolImage !== null && !isValidDockerImageRef(sandboxExegolImage)) {
    return NextResponse.json({ error: 'invalid sandboxExegolImage' }, { status: 400 });
  }
  if (
    sandboxDockerNetwork !== undefined &&
    sandboxDockerNetwork !== null &&
    !['none', 'bridge'].includes(sandboxDockerNetwork)
  ) {
    return NextResponse.json({ error: 'sandboxDockerNetwork must be none, bridge, or null' }, { status: 400 });
  }

  const sandboxTouched =
    sandboxNovatrixImage !== undefined ||
    sandboxExegolImage !== undefined ||
    sandboxDockerNetwork !== undefined ||
    sandboxEnableNovatrix !== undefined ||
    sandboxEnableExegol !== undefined;

  const updated = await prisma.session.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(targetId !== undefined ? { targetId: targetId || null } : {}),
      ...(sandboxNovatrixImage !== undefined ? { sandboxNovatrixImage } : {}),
      ...(sandboxExegolImage !== undefined ? { sandboxExegolImage } : {}),
      ...(sandboxDockerNetwork !== undefined ? { sandboxDockerNetwork } : {}),
      ...(sandboxEnableNovatrix !== undefined ? { sandboxEnableNovatrix } : {}),
      ...(sandboxEnableExegol !== undefined ? { sandboxEnableExegol } : {}),
      ...(sandboxTouched ? { sandboxPullSignature: null } : {}),
    },
    include: { target: true },
  });
  return NextResponse.json(updated);
}
