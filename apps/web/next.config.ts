import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryEnvFile = path.resolve(appDirectory, '..', '..', '.env');

if (existsSync(repositoryEnvFile)) process.loadEnvFile(repositoryEnvFile);

const workspaceRoot = path.resolve(appDirectory, '..', '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
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
