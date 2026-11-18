import { createRequire } from 'node:module';
import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';

const OLDEST_NODE_THAT_SCANS_DOT_DIRECTORIES = 24;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < OLDEST_NODE_THAT_SCANS_DOT_DIRECTORIES) {
  throw new Error(
    `The Workers build needs Node ${OLDEST_NODE_THAT_SCANS_DOT_DIRECTORIES} or newer, found ${process.versions.node}. Older releases skip src/app/.well-known when routes are scanned, so OAuth discovery would silently answer 404.`,
  );
}

const require = createRequire(import.meta.url);

function packageFile(name: string, file: string): string {
  return path.join(path.dirname(require.resolve(`${name}/package.json`)), file);
}

const SERVER_COMPONENT_ENVIRONMENT = 'rsc';

const EMAIL_SOURCES = /\/(?:node_modules\/@react-email|packages\/services\/src\/email)\//;

const REACT_DOM_SERVER_FILES =
  /\/node_modules\/react-dom\/(?:index|server\.edge|cjs\/react-dom\.(?:production|development)|cjs\/react-dom-server[^/]*)\.js$/;

function rendersEmail(importer: string): boolean {
  return EMAIL_SOURCES.test(importer) || REACT_DOM_SERVER_FILES.test(importer);
}

const CLIENT_REACT_BUILDS: Readonly<Record<string, string>> = {
  react: packageFile('react', 'index.js'),
  'react/jsx-runtime': packageFile('react', 'jsx-runtime.js'),
  'react/jsx-dev-runtime': packageFile('react', 'jsx-dev-runtime.js'),
  'react-dom': packageFile('react-dom', 'index.js'),
  'react-dom/server': packageFile('react-dom', 'server.edge.js'),
  'react-dom/server.edge': packageFile('react-dom', 'server.edge.js'),
};

function emailsRenderWithClientReact(): Plugin {
  return {
    name: 'orbit:emails-render-with-client-react',
    enforce: 'pre',
    resolveId(source, importer) {
      if (this.environment.name !== SERVER_COMPONENT_ENVIRONMENT) return null;
      if (importer === undefined || !rendersEmail(importer)) return null;
      return CLIENT_REACT_BUILDS[source] ?? null;
    },
  };
}

export default defineConfig({
  plugins: [
    emailsRenderWithClientReact(),
    vinext({ react: { compiler: true } }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
});
