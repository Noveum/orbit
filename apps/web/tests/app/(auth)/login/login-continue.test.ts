import { describe, expect, it } from 'bun:test';
import { mcpContinueUrl, safeCallback } from '../../../../src/app/(auth)/login/continue-url.ts';

describe('mcpContinueUrl', () => {
  it('rebuilds the authorize URL from a paused MCP request', () => {
    const url = mcpContinueUrl({
      response_type: 'code',
      client_id: 'client_123',
      redirect_uri: 'http://127.0.0.1:9000/callback',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      scope: 'openid orbit.read',
      state: 'xyz',
      prompt: 'consent',
    });
    expect(url).toBeDefined();
    const parsed = new URL(url ?? '', 'http://localhost:3000');
    expect(parsed.pathname).toBe('/api/auth/mcp/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client_123');
    expect(parsed.searchParams.get('code_challenge')).toBe('abc');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('ignores a request that is not an MCP authorize', () => {
    expect(mcpContinueUrl({ next: '/my-issues' })).toBeUndefined();
    expect(mcpContinueUrl({ client_id: 'x' })).toBeUndefined();
  });
});

describe('safeCallback', () => {
  it('accepts a same-origin path and rejects an absolute URL', () => {
    expect(safeCallback('/settings')).toBe('/settings');
    expect(safeCallback('https://evil.example')).toBeUndefined();
    expect(safeCallback('//evil.example')).toBeUndefined();
  });
});
