import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { targets: true },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const p = await prisma.project.create({
    data: { name, description: typeof body.description === 'string' ? body.description : undefined },
  });
  return NextResponse.json(p);
}
