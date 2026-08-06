import { describe, expect, it } from 'bun:test';
import { GET } from '../../../../../src/app/api/oauth/start/route.ts';

describe('oauth start', () => {
  it('forces prompt=consent and forwards to the better-auth authorize endpoint', () => {
    const request = new Request(
      'http://localhost:3000/api/oauth/start?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcb&code_challenge=xyz',
    );
    const response = GET(request);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/api/auth/mcp/authorize');
    expect(location.searchParams.get('prompt')).toBe('consent');
    expect(location.searchParams.get('client_id')).toBe('abc');
    expect(location.searchParams.get('code_challenge')).toBe('xyz');
  });

  it('overrides a prompt supplied by the client', () => {
    const request = new Request(
      'http://localhost:3000/api/oauth/start?client_id=abc&response_type=code&prompt=none',
    );
    const location = new URL(GET(request).headers.get('location') ?? '');
    expect(location.searchParams.get('prompt')).toBe('consent');
  });
});
