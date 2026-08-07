import { beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  exchangeGithubUserCode,
  fetchGithubInstallation,
  fetchInstalledRepositories,
  forgetGithubInstallationTokens,
  GITHUB_MAX_REPOSITORY_PAGES,
  GITHUB_REPOSITORY_PAGE_SIZE,
  GITHUB_TOKEN_REFRESH_MARGIN_MS,
  githubAppJwt,
  githubInstallationToken,
  listInstallationRepositoryPage,
  listUserInstallationIds,
} from '../../src/github/app.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function jsonFetch(
  handler: (url: string, init?: RequestInit) => Response,
): typeof globalThis.fetch {
  return ((url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init))) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  forgetGithubInstallationTokens();
});

describe('githubInstallationToken', () => {
  function countingFetch(counts: { minted: number }, expiresAt: string | null) {
    return jsonFetch((url) => {
      expect(url).toContain('/access_tokens');
      counts.minted += 1;
      return new Response(
        JSON.stringify({ token: `ghs_${counts.minted}`, expires_at: expiresAt }),
        {
          status: 201,
        },
      );
    });
  }

  it('mints once and serves the cached token to later callers', async () => {
    const counts = { minted: 0 };
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const request = {
      appId: '123456',
      privateKey,
      installationId: '9001',
      fetch: countingFetch(counts, expiresAt),
    };

    expect(await githubInstallationToken(request)).toBe('ghs_1');
    expect(await githubInstallationToken(request)).toBe('ghs_1');
    expect(await githubInstallationToken(request)).toBe('ghs_1');
    expect(counts.minted).toBe(1);
  });

  it('mints again once the token is inside its refresh margin', async () => {
    const counts = { minted: 0 };
    const nearlyExpired = new Date(
      Date.now() + GITHUB_TOKEN_REFRESH_MARGIN_MS - 1000,
    ).toISOString();
    const request = {
      appId: '123456',
      privateKey,
      installationId: '9002',
      fetch: countingFetch(counts, nearlyExpired),
    };

    expect(await githubInstallationToken(request)).toBe('ghs_1');
    expect(await githubInstallationToken(request)).toBe('ghs_2');
    expect(counts.minted).toBe(2);
  });

  it('never serves one installation the token minted for another', async () => {
    const counts = { minted: 0 };
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const fetchImpl = countingFetch(counts, expiresAt);

    const first = await githubInstallationToken({
      appId: '123456',
      privateKey,
      installationId: '9003',
      fetch: fetchImpl,
    });
    const second = await githubInstallationToken({
      appId: '123456',
      privateKey,
      installationId: '9004',
      fetch: fetchImpl,
    });

    expect(first).not.toBe(second);
    expect(counts.minted).toBe(2);
  });
});

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

describe('fetchGithubInstallation', () => {
  it('normalizes the account, its type and the repository selection', async () => {
    const calls: string[] = [];
    const fetchImpl = jsonFetch((url) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          id: 151887625,
          account: { login: 'Noveum', id: 192082188, type: 'Organization' },
          target_type: 'Organization',
          repository_selection: 'all',
          suspended_at: null,
        }),
        { status: 200 },
      );
    });

    const account = await fetchGithubInstallation({
      appId: '123456',
      privateKey,
      installationId: '151887625',
      fetch: fetchImpl,
    });

    expect(account).toEqual({
      installationId: '151887625',
      accountLogin: 'Noveum',
      accountId: '192082188',
      accountType: 'Organization',
      repositorySelection: 'all',
      suspended: false,
    });
    expect(calls[0]).toContain('/app/installations/151887625');
  });

  it('reports a suspended installation as suspended', async () => {
    const account = await fetchGithubInstallation({
      appId: '123456',
      privateKey,
      installationId: '5',
      fetch: jsonFetch(
        () =>
          new Response(
            JSON.stringify({
              id: 5,
              account: { login: 'acme', id: 1, type: 'Organization' },
              repository_selection: 'selected',
              suspended_at: '2026-08-01T00:00:00Z',
            }),
            { status: 200 },
          ),
      ),
    });
    expect(account.suspended).toBe(true);
  });

  it('raises rather than inventing an installation when GitHub says it is gone', async () => {
    await expect(
      fetchGithubInstallation({
        appId: '123456',
        privateKey,
        installationId: '404',
        fetch: jsonFetch(() => new Response('{}', { status: 404 })),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('fetchInstalledRepositories', () => {
  it('mints a token then normalizes owner, visibility and archive state', async () => {
    const calls: string[] = [];
    const fetchImpl = jsonFetch((url, init) => {
      calls.push(url);
      if (url.includes('access_tokens')) {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({ token: 'ghs_installation' }), { status: 201 });
      }
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer ghs_installation');
      return new Response(
        JSON.stringify({
          total_count: 1,
          repositories: [
            {
              id: 900712888,
              name: 'magic-experiments',
              full_name: 'Noveum/magic-experiments',
              private: true,
              archived: false,
              default_branch: 'trunk',
              html_url: 'https://github.com/Noveum/magic-experiments',
              owner: { login: 'Noveum' },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const repos = await fetchInstalledRepositories({
      appId: '123456',
      privateKey,
      installationId: '9001',
      fetch: fetchImpl,
    });

    expect(repos).toEqual([
      {
        repositoryId: '900712888',
        repositoryName: 'Noveum/magic-experiments',
        name: 'magic-experiments',
        ownerLogin: 'Noveum',
        private: true,
        archived: false,
        defaultBranch: 'trunk',
        htmlUrl: 'https://github.com/Noveum/magic-experiments',
      },
    ]);
    expect(calls[0]).toContain('/app/installations/9001/access_tokens');
    expect(calls[1]).toContain('/installation/repositories');
  });

  it('walks every page so a workspace with more than one page sees them all', async () => {
    const pages: string[] = [];
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 });
      }
      pages.push(url);
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      const perPage = Number(new URL(url).searchParams.get('per_page') ?? '100');
      const total = 150;
      const start = (page - 1) * perPage;
      const count = Math.max(0, Math.min(perPage, total - start));
      return new Response(
        JSON.stringify({
          total_count: total,
          repositories: Array.from({ length: count }, (_unused, index) => ({
            id: start + index,
            full_name: `Noveum/repo-${start + index}`,
          })),
        }),
        { status: 200 },
      );
    });

    const repos = await fetchInstalledRepositories({
      appId: '123456',
      privateKey,
      installationId: '9001',
      fetch: fetchImpl,
    });

    expect(repos).toHaveLength(150);
    expect(pages).toHaveLength(2);
    expect(repos.at(-1)?.repositoryName).toBe('Noveum/repo-149');
  });

  it('refuses to hand back a truncated snapshot when the pages never run out', async () => {
    let pages = 0;
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 });
      }
      pages += 1;
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      const perPage = GITHUB_REPOSITORY_PAGE_SIZE;
      const start = (page - 1) * perPage;
      return new Response(
        JSON.stringify({
          total_count: 1_000_000,
          repositories: Array.from({ length: perPage }, (_unused, index) => ({
            id: start + index,
            full_name: `Noveum/repo-${start + index}`,
          })),
        }),
        { status: 200 },
      );
    });

    await expect(
      fetchInstalledRepositories({
        appId: '123456',
        privateKey,
        installationId: '9001',
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/snapshot is incomplete/);

    expect(pages).toBe(GITHUB_MAX_REPOSITORY_PAGES);
  });

  it('stops rather than looping when a page comes back short of the claimed total', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_x' }), { status: 201 });
      }
      return new Response(
        JSON.stringify({
          total_count: 9999,
          repositories: [{ id: 1, full_name: 'Noveum/only' }],
        }),
        { status: 200 },
      );
    });

    const repos = await fetchInstalledRepositories({
      appId: '123456',
      privateKey,
      installationId: '9001',
      fetch: fetchImpl,
    });
    expect(repos).toHaveLength(1);
  });
});

describe('listInstallationRepositoryPage', () => {
  it('derives the owner from the full name when GitHub omits the owner object', async () => {
    const page = await listInstallationRepositoryPage({
      token: 'ghs_x',
      page: 1,
      fetch: jsonFetch(
        () =>
          new Response(
            JSON.stringify({
              total_count: 1,
              repositories: [{ id: 7, full_name: 'apimarket/gateway' }],
            }),
            { status: 200 },
          ),
      ),
    });

    expect(page.repositories[0]?.ownerLogin).toBe('apimarket');
    expect(page.repositories[0]?.name).toBe('gateway');
    expect(page.repositories[0]?.defaultBranch).toBe('main');
  });
});

describe('listUserInstallationIds', () => {
  it('returns the installations the signed-in user can actually reach', async () => {
    const ids = await listUserInstallationIds({
      userToken: 'ghu_x',
      fetch: jsonFetch((url, init) => {
        expect(url).toContain('/user/installations');
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers['authorization']).toBe('Bearer ghu_x');
        return new Response(
          JSON.stringify({ total_count: 2, installations: [{ id: 151887625 }, { id: 151889033 }] }),
          { status: 200 },
        );
      }),
    });

    expect(ids).toEqual(['151887625', '151889033']);
  });
});

describe('exchangeGithubUserCode', () => {
  it('posts the code and returns the user access token', async () => {
    let body = '';
    const token = await exchangeGithubUserCode({
      clientId: 'Iv1.abc',
      clientSecret: 'shh',
      code: 'the-code',
      fetch: jsonFetch((url, init) => {
        expect(url).toContain('/login/oauth/access_token');
        body = String(init?.body);
        return new Response(JSON.stringify({ access_token: 'ghu_token' }), { status: 200 });
      }),
    });

    expect(token).toBe('ghu_token');
    expect(body).toContain('code=the-code');
    expect(body).toContain('client_id=Iv1.abc');
  });

  it('raises when GitHub rejects the code instead of returning an empty token', async () => {
    await expect(
      exchangeGithubUserCode({
        clientId: 'Iv1.abc',
        clientSecret: 'shh',
        code: 'stale',
        fetch: jsonFetch(
          () => new Response(JSON.stringify({ error: 'bad_verification_code' }), { status: 200 }),
        ),
      }),
    ).rejects.toThrow(/bad_verification_code/);
  });
});
