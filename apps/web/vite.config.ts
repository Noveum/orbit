import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

const OLDEST_NODE_THAT_SCANS_DOT_DIRECTORIES = 24;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < OLDEST_NODE_THAT_SCANS_DOT_DIRECTORIES) {
  throw new Error(
    `The Workers build needs Node ${OLDEST_NODE_THAT_SCANS_DOT_DIRECTORIES} or newer, found ${process.versions.node}. Older releases skip src/app/.well-known when routes are scanned, so OAuth discovery would silently answer 404.`,
  );
}

export default defineConfig({
  plugins: [
    vinext({ react: { compiler: true } }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
});
