import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

export async function POST(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const session = await prisma.session.create({
    data: {
      title: 'New assessment',
      sandboxEnableNovatrix: true,
      sandboxEnableExegol: true,
      /** Prefer bridge so both images can pull templates and tools can reach targets/DNS when SANDBOX_MODE=docker. */
      sandboxDockerNetwork: 'bridge',
    },
  });
  return NextResponse.json({ id: session.id });
}

export async function GET() {
  const sessions = await prisma.session.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, updatedAt: true },
  });
  return NextResponse.json(sessions);
}
