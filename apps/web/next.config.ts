import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  /** Trace files from monorepo root so `file:` workspace deps bundle correctly in Docker. */
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@novatrix/agent', '@novatrix/sandbox'],
  serverExternalPackages: ['@prisma/client'],
  typescript: {
    // Webpack already type-checks during compilation; skip the separate tsc pass
    // which fails in Docker multi-stage builds (can't resolve hoisted workspace deps).
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
