import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  /** Trace files from monorepo root so `file:` workspace deps bundle correctly in Docker. */
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@novatrix/agent', '@novatrix/sandbox'],
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
