import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertMutationAuthorized } from '@/lib/mutationAuth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: projectId } = await params;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const label = typeof body.label === 'string' ? body.label.trim() : 'Target';
  const urlPattern = typeof body.urlPattern === 'string' ? body.urlPattern.trim() : '';
  if (!urlPattern) {
    return NextResponse.json({ error: 'urlPattern required' }, { status: 400 });
  }
  const t = await prisma.target.create({
    data: { projectId, label, urlPattern },
  });
  return NextResponse.json(t);
}
