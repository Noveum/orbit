import { describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { fetchInstalledRepositories, githubAppJwt } from './app.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('githubAppJwt', () => {
  it('produces a well-formed RS256 JWT with the expected claims', () => {
    const now = new Date('2026-07-24T00:00:00.000Z');
    const token = githubAppJwt({ appId: '123456', privateKey, now });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);

    const [headerPart, payloadPart, signaturePart] = parts;
    expect(decodeSegment(headerPart ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' });

    const payload = decodeSegment(payloadPart ?? '');
    const issuedAt = Math.floor(now.getTime() / 1000);
    expect(payload).toEqual({ iat: issuedAt - 60, exp: issuedAt + 540, iss: '123456' });
    expect((signaturePart ?? '').length).toBeGreaterThan(0);
  });
});

describe('fetchInstalledRepositories', () => {
  it('mints a token then normalizes the installed repositories', async () => {
    const calls: string[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes('access_tokens')) {
        expect(init?.method).toBe('POST');
        return Promise.resolve(
          new Response(JSON.stringify({ token: 'ghs_installation' }), { status: 201 }),
        );
      }
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer ghs_installation');
      return Promise.resolve(
        new Response(
          JSON.stringify({
            repositories: [{ id: 42, full_name: 'acme/web', default_branch: 'trunk' }],
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof globalThis.fetch;

    const repos = await fetchInstalledRepositories({
      appId: '123456',
      privateKey,
      installationId: '9001',
      fetch: fetchImpl,
    });

    expect(repos).toEqual([
      { repositoryId: '42', repositoryName: 'acme/web', defaultBranch: 'trunk' },
    ]);
    expect(calls[0]).toContain('/app/installations/9001/access_tokens');
    expect(calls[1]).toContain('/installation/repositories');
  });
});
