import { describe, expect, it } from 'bun:test';
import {
  loginMetadata,
  mcpContinueUrl,
  safeCallback,
} from '../../../../src/app/(auth)/login/continue-url.ts';

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

describe('loginMetadata', () => {
  const signIn = { title: 'Sign in' };

  it('names the issue a signed-out visitor was heading to', () => {
    const meta = loginMetadata('/issue/ENG-1');
    expect(meta.title).toBe('ENG-1');
    expect(meta.openGraph?.title).toBe('ENG-1 · Orbit');
    expect(meta.twitter?.title).toBe('ENG-1 · Orbit');
    expect(meta.openGraph?.url).toBe('/issue/ENG-1');
  });

  it('uppercases the identifier and drops the query string', () => {
    const meta = loginMetadata('/issue/eng-42?comment=c_1&_rsc=abc');
    expect(meta.title).toBe('ENG-42');
    expect(meta.openGraph?.url).toBe('/issue/ENG-42');
  });

  it('names the project by its slug, on the project page and on its tabs', () => {
    const meta = loginMetadata('/projects/apollo-11');
    expect(meta.title).toBe('apollo-11');
    expect(meta.openGraph?.title).toBe('apollo-11 · Orbit');
    expect(meta.twitter?.title).toBe('apollo-11 · Orbit');
    expect(meta.openGraph?.url).toBe('/projects/apollo-11');
    const tab = loginMetadata('/projects/apollo-11/issues?filter=open');
    expect(tab.title).toBe('apollo-11');
    expect(tab.openGraph?.url).toBe('/projects/apollo-11/issues');
  });

  it('falls back to the plain sign in title without a previewable destination', () => {
    for (const next of [
      undefined,
      '',
      '/my-issues',
      '/issue',
      '/issue/',
      '/projects',
      '/projects/',
    ]) {
      expect(loginMetadata(next)).toEqual(signIn);
    }
  });

  it('never reflects a hostile next value into the preview', () => {
    const hostile = [
      '/issue/<script>',
      '/issue/<script>alert(1)</script>',
      '//evil.example',
      '//evil.example/issue/ENG-1',
      'https://evil.example/issue/ENG-1',
      '/\\evil.example/issue/ENG-1',
      '/issue/ENG-1/../../x',
      '/issue/ENG-1/comments',
      '/issue/ENG-1/',
      '/issue/ENG-1#frag',
      '/issue/ENG-1%0A',
      '/issue/ENG-1\nENG-2',
      '/issue/ENG-1-2',
      '/issue/ENG-',
      '/issue/ENG-0',
      '/issue/-1',
      '/issue/E-1',
      '/issue/TOOLONGKEY-1',
      '/issue/ENG-1234567890',
      '/issue/ENG 1',
      '/issue/ßs-1',
      '/issue/ſng-1',
      '/issue/ENK-1',
      '/issues/ENG-1',
      '/api/issue/ENG-1',
      '/projects/Apollo',
      '/projects/apollo_11',
      '/projects/apollo--11',
      '/projects/-apollo',
      '/projects/<script>',
      '/projects/apollo/../../x',
      '/projects/apollo/unknown-tab',
      '/projects/apollo/issues/extra',
      `/projects/${'a'.repeat(81)}`,
      `/issue/${'A'.repeat(5000)}`,
      `/issue/ENG-1?${'a'.repeat(5000)}`,
      `/projects/${'a-'.repeat(2500)}a`,
    ];
    for (const next of hostile) expect(loginMetadata(next)).toEqual(signIn);
    expect(loginMetadata(['/issue/ENG-1'])).toEqual(signIn);
    expect(loginMetadata(['/issue/ENG-1', '/projects/apollo'])).toEqual(signIn);
  });
});
