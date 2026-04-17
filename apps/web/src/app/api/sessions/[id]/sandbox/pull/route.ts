import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEnv } from '@/lib/env';
import { assertMutationAuthorized } from '@/lib/mutationAuth';
import { pullDockerImages } from '@/lib/dockerPull';
import { buildSandboxProfiles, dockerImagesForProfiles } from '@/lib/sessionSandbox';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertMutationAuthorized(req);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id: sessionId } = await params;
  const env = getEnv();
  if (env.sandboxMode !== 'docker') {
    return NextResponse.json({ error: 'SANDBOX_MODE is not docker; nothing to pull' }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  const profiles = buildSandboxProfiles(session, env, '/tmp/novatrix-pull-placeholder');
  const images = dockerImagesForProfiles(profiles);
  if (!images.length) {
    return NextResponse.json({ error: 'No Docker images configured for this session' }, { status: 400 });
  }

  const results = await pullDockerImages(images);
  return NextResponse.json({ results });
}
