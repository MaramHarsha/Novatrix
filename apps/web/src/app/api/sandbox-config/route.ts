import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { DEFAULT_EXEGOL_IMAGE } from '@/lib/sessionSandbox';

/** Public hints for the UI (no secrets). */
export async function GET() {
  const env = getEnv();
  return NextResponse.json({
    sandboxMode: env.sandboxMode,
    defaultNovatrixImage: env.sandboxImage,
    defaultExegolImage: DEFAULT_EXEGOL_IMAGE,
    defaultDockerNetwork: env.sandboxDockerNetwork,
  });
}
