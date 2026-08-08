import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDirectory, '..', '..');

const workspacePackages = [
  '@orbit/shared',
  '@orbit/db',
  '@orbit/core',
  '@orbit/services',
  '@orbit/realtime-client',
  '@orbit/realtime-server',
  '@orbit/mcp-server',
];

const devServerOnlyBundledPackages = ['@react-email/render', '@react-email/components', 'prettier'];

function standaloneOutputUnlessVercelTracesItItself(): Pick<NextConfig, 'output'> {
  return process.env['VERCEL'] === '1' ? {} : { output: 'standalone' };
}

export default function config(phase: string): NextConfig {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    reactCompiler: true,
    ...standaloneOutputUnlessVercelTracesItItself(),
    outputFileTracingRoot: workspaceRoot,
    turbopack: {
      root: workspaceRoot,
    },
    transpilePackages: isDevServer
      ? [...workspacePackages, ...devServerOnlyBundledPackages]
      : workspacePackages,
    typedRoutes: false,
    experimental: {
      optimizePackageImports: ['lucide-react'],
    },
  };
}
