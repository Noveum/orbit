import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const webRoot = fileURLToPath(new URL('../../../', import.meta.url));
const resultSchema = z.object({
  discovery: z.object({
    url: z.string(),
    transport: z.string(),
    authentication: z.object({ type: z.string(), required: z.boolean() }),
  }),
  cors: z.string().nullable(),
  preflight: z.number(),
  claimStatus: z.number(),
  claim: z.object({ claim: z.string() }).nullable(),
});

test.each([
  {
    appUrl: 'https://orbit.noveum.ai',
    requestOrigin: 'https://orbit.noveum.ai',
    override: '',
    endpoint: 'https://orbit.noveum.ai/mcp',
    claimStatus: 200,
  },
  {
    appUrl: 'https://orbit.example.com',
    requestOrigin: 'https://orbit.example.com',
    override: '',
    endpoint: 'https://orbit.example.com/mcp',
    claimStatus: 404,
  },
  {
    appUrl: 'https://orbit.noveum.ai',
    requestOrigin: 'https://preview.example.com',
    override: 'https://mcp.example.com/orbit',
    endpoint: 'https://mcp.example.com/orbit',
    claimStatus: 404,
  },
])('registry metadata respects deployment $appUrl and request $requestOrigin', async (fixture) => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
const discovery = await import('./src/app/.well-known/mcp.json/route.ts');
const glama = await import('./src/app/.well-known/glama.json/route.ts');
const response = discovery.GET();
const claim = glama.GET(new Request(process.env.REGISTRY_REQUEST_ORIGIN + '/.well-known/glama.json'));
console.log(JSON.stringify({
  discovery: await response.json(),
  cors: response.headers.get('access-control-allow-origin'),
  preflight: discovery.OPTIONS().status,
  claimStatus: claim.status,
  claim: claim.ok ? await claim.json() : null,
}));
`,
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NEXT_PUBLIC_APP_URL: fixture.appUrl,
        NEXT_PUBLIC_MCP_URL: fixture.override,
        REGISTRY_REQUEST_ORIGIN: fixture.requestOrigin,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, stderr }).toMatchObject({ code: 0 });
  const result = resultSchema.parse(JSON.parse(stdout));
  expect(result.discovery).toEqual({
    url: fixture.endpoint,
    transport: 'streamable-http',
    authentication: { type: 'oauth2', required: true },
  });
  expect(result.cors).toBe('*');
  expect(result.preflight).toBe(204);
  expect(result.claimStatus).toBe(fixture.claimStatus);
  if (fixture.claimStatus === 200) expect(result.claim?.claim).toStartWith('glama_claim_');
  else expect(result.claim).toBeNull();
});
