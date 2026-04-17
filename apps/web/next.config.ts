import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novatrix/agent', '@novatrix/sandbox'],
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
