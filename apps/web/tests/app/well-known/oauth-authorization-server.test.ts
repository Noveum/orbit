import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

const ROUTE = 'src/app/.well-known/oauth-authorization-server/route.ts';

describe('the oauth authorization server metadata', () => {
  it('resolves OAuth metadata from the incoming request host', async () => {
    const source = await readFile(ROUTE, 'utf8');
    expect(source).toContain('GET(request: Request)');
    expect(source).toContain('auth.api.getMcpOAuthConfig({ headers: request.headers })');
  });
});
