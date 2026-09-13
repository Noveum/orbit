import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('OAuth discovery with deployment host resolution', () => {
  it.each(['oauth-authorization-server', 'openid-configuration'])(
    'serves %s when authentication uses dynamic allowed hosts',
    async (route) => {
      const subprocess = Bun.spawn(
        [
          process.execPath,
          '--eval',
          `
          const { GET } = await import('./src/app/.well-known/${route}/route.ts');
          const response = await GET(new Request('https://orbit.example.com/.well-known/${route}', {
            headers: { host: 'orbit.example.com', 'x-forwarded-proto': 'https' },
          }));
          console.log(JSON.stringify({
            status: response.status,
            cors: response.headers.get('access-control-allow-origin'),
            metadata: await response.json(),
          }));
          `,
        ],
        {
          cwd: webRoot,
          env: {
            ...process.env,
            BETTER_AUTH_URL: 'https://orbit.example.com',
            NEXT_PUBLIC_APP_URL: 'https://orbit.example.com',
            ORBIT_AUTH_ALLOWED_HOSTS: 'orbit-preview.vercel.app',
            VERCEL_URL: 'orbit-preview.vercel.app',
          },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
        subprocess.exited,
      ]);
      expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
      const output = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
      expect(output).toMatchObject({
        status: 200,
        cors: '*',
        metadata: {
          issuer: 'https://orbit.example.com',
          authorization_endpoint: 'https://orbit.example.com/api/oauth/start',
          token_endpoint: 'https://orbit.example.com/api/auth/mcp/token',
          registration_endpoint: 'https://orbit.example.com/api/auth/mcp/register',
          scopes_supported: expect.arrayContaining(['orbit.read', 'orbit.write']),
        },
      });
    },
  );
});
