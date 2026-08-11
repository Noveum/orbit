import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import { assertProductionAuthenticationConfigured } from './src/lib/env.ts';

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
  if (phase === PHASE_PRODUCTION_BUILD) {
    assertProductionAuthenticationConfigured({
      NODE_ENV: 'production',
      ORBIT_PASSWORD_AUTH: process.env['ORBIT_PASSWORD_AUTH'],
      GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
      GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
      GITHUB_CLIENT_ID: process.env['GITHUB_CLIENT_ID'],
      GITHUB_CLIENT_SECRET: process.env['GITHUB_CLIENT_SECRET'],
      RESEND_API_KEY: process.env['RESEND_API_KEY'],
      EMAIL_FROM: process.env['EMAIL_FROM'],
    });
  }

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
