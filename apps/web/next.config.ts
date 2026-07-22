import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: path.resolve(appDirectory, '..', '..'),
  },
  transpilePackages: [
    '@orbit/shared',
    '@orbit/db',
    '@orbit/core',
    '@orbit/services',
    '@orbit/realtime-client',
  ],
  serverExternalPackages: ['pg'],
  typedRoutes: false,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
