import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
