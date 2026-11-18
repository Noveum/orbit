import { beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { forgetGithubInstallationTokens, githubInstallationToken } from '../../src/github/app.ts';
import { verifyGithubRecoveryProvider } from '../../src/github/recovery-provider.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const HEAD = '0123456789abcdef0123456789abcdef01234567';
const TOKEN = 'fixture-scoped-token-never-return';
const target = {
  appId: '123456',
  privateKey,
  installationId: '9001',
  accountId: '500',
  repositoryId: '99',
  pullRequestNumber: 7,
};
const installation = { id: 9001, app_id: 123456, account: { id: 500 }, suspended_at: null };
const repositories = {
  total_count: 1,
  repositories: [{ id: 99, full_name: 'fixture-owner/current-name' }],
};
const pull = {
  id: 7007,
  number: 7,
  state: 'open',
  merged: false,
  draft: true,
  head: { sha: HEAD },
  base: { repo: { id: 99 } },
  updated_at: '2026-11-17T10:00:00Z',
};
type Stage = 'installation' | 'token' | 'repository' | 'pull';

function stageFor(path: string): Stage {
  if (path.endsWith('/access_tokens')) return 'token';
  if (path === '/installation/repositories') return 'repository';
  if (path.includes('/pulls/')) return 'pull';
  return 'installation';
}

function transport(
  overrides: Partial<Record<Stage, Response>> = {},
  requests: { stage: Stage; body: unknown }[] = [],
): typeof globalThis.fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://api.github.com');
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
    const stage = stageFor(url.pathname);
    requests.push({ stage, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (stage === 'token') expect(requests.at(-1)?.body).toEqual({ repository_ids: [99] });
    if (stage === 'pull') expect(url.pathname).toBe('/repos/fixture-owner/current-name/pulls/7');
    if (stage === 'repository' || stage === 'pull')
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    if (overrides[stage] !== undefined) return Promise.resolve(overrides[stage]);
    const payloads: Record<Stage, unknown> = {
      installation,
      token: { token: TOKEN },
      repository: repositories,
      pull,
    };
    return Promise.resolve(Response.json(payloads[stage]));
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => forgetGithubInstallationTokens());

describe('verifyGithubRecoveryProvider', () => {
  it('verifies current identities and uses a scoped token without returning it', async () => {
    const requests: { stage: Stage; body: unknown }[] = [];
    const result = await verifyGithubRecoveryProvider({
      ...target,
      fetch: transport({}, requests),
    });
    expect(result).toEqual({
      installationId: '9001',
      appId: '123456',
      accountId: '500',
      repositoryId: '99',
      repositoryName: 'fixture-owner/current-name',
      externalId: '7007',
      number: 7,
      state: 'open',
      merged: false,
      draft: true,
      headSha: HEAD,
      providerUpdatedAt: '2026-11-17T10:00:00.000Z',
    });
    expect(requests.map((request) => request.stage)).toEqual([
      'installation',
      'token',
      'repository',
      'pull',
    ]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('does not cache or reuse the restricted token as an ordinary installation token', async () => {
    const first: { stage: Stage; body: unknown }[] = [];
    const second: { stage: Stage; body: unknown }[] = [];
    await verifyGithubRecoveryProvider({ ...target, fetch: transport({}, first) });
    await verifyGithubRecoveryProvider({ ...target, fetch: transport({}, second) });
    expect(first.filter((request) => request.stage === 'token')).toHaveLength(1);
    expect(second.filter((request) => request.stage === 'token')).toHaveLength(1);
    const full = await githubInstallationToken({
      ...target,
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBeUndefined();
        return Promise.resolve(Response.json({ token: 'fixture-full-token' }));
      }) as unknown as typeof globalThis.fetch,
    });
    expect(full).toBe('fixture-full-token');
  });

  it('stops before token creation for a suspended installation', async () => {
    const requests: { stage: Stage; body: unknown }[] = [];
    await expect(
      verifyGithubRecoveryProvider({
        ...target,
        fetch: transport(
          {
            installation: Response.json({ ...installation, suspended_at: '2026-11-17T10:00:00Z' }),
          },
          requests,
        ),
      }),
    ).rejects.toMatchObject({ details: { reason: 'github_installation_suspended' } });
    expect(requests.map((request) => request.stage)).toEqual(['installation']);
  });

  it('rejects a different App or repository rather than guessing a mapping', async () => {
    await expect(
      verifyGithubRecoveryProvider({
        ...target,
        fetch: transport({ installation: Response.json({ ...installation, app_id: 999 }) }),
      }),
    ).rejects.toMatchObject({
      details: { reason: 'github_recovery_identity_mismatch', operation: 'installation' },
    });
    await expect(
      verifyGithubRecoveryProvider({
        ...target,
        fetch: transport({
          repository: Response.json({
            total_count: 1,
            repositories: [{ id: 100, full_name: 'other/repo' }],
          }),
        }),
      }),
    ).rejects.toMatchObject({
      details: { reason: 'github_recovery_identity_mismatch', operation: 'repository' },
    });
  });

  it('preserves closed and merged state so the service cannot mistake it for active', async () => {
    const result = await verifyGithubRecoveryProvider({
      ...target,
      fetch: transport({ pull: Response.json({ ...pull, state: 'closed', merged: true }) }),
    });
    expect(result.state).toBe('closed');
    expect(result.merged).toBe(true);
  });

  it('keeps401 authentication,404 installation and422 scoped access failures distinct and redacted', async () => {
    for (const [stage, status, operation] of [
      ['installation', 401, 'installation'],
      ['installation', 404, 'installation'],
      ['token', 422, 'installation token'],
    ] as const) {
      const caught = await verifyGithubRecoveryProvider({
        ...target,
        fetch: transport({ [stage]: Response.json({ message: TOKEN }, { status }) }),
      }).catch((error: unknown) => error);
      expect(caught).toMatchObject({
        details: { reason: 'github_provider_http_error', operation, httpStatus: status },
      });
      expect(JSON.stringify(caught)).not.toContain(TOKEN);
    }
  });

  it('rejects a PR for another base repository or incomplete state', async () => {
    await expect(
      verifyGithubRecoveryProvider({
        ...target,
        fetch: transport({ pull: Response.json({ ...pull, base: { repo: { id: 100 } } }) }),
      }),
    ).rejects.toMatchObject({
      details: { reason: 'github_recovery_identity_mismatch', operation: 'pull request' },
    });
    await expect(
      verifyGithubRecoveryProvider({
        ...target,
        fetch: transport({ pull: Response.json({ ...pull, state: undefined }) }),
      }),
    ).rejects.toMatchObject({
      details: { reason: 'github_provider_payload_invalid', operation: 'pull request' },
    });
  });

  it('bounds the whole verification and redacts an aborting transport error', async () => {
    const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(new Error(TOKEN));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener('abort', fail, { once: true });
      })) as unknown as typeof globalThis.fetch;
    const caught = await verifyGithubRecoveryProvider({ ...target, fetch, budgetMs: 5 }).catch(
      (error: unknown) => error,
    );
    expect(caught).toMatchObject({ details: { reason: 'github_recovery_expired' } });
    expect(JSON.stringify(caught)).not.toContain(TOKEN);
  });
});

describe('recovery transport resource boundaries', () => {
  it('cancels a stalled body when the overall budget expires', async () => {
    let cancelled = false;
    const fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
      )) as unknown as typeof globalThis.fetch;
    await expect(
      verifyGithubRecoveryProvider({ ...target, fetch, budgetMs: 5 }),
    ).rejects.toMatchObject({ details: { reason: 'github_recovery_expired' } });
    expect(cancelled).toBe(true);
  });

  it('cancels an oversized provider body without retaining it', async () => {
    let cancelled = false;
    const fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(1_048_577));
          },
          cancel() {
            cancelled = true;
          },
        }),
      )) as unknown as typeof globalThis.fetch;
    await expect(verifyGithubRecoveryProvider({ ...target, fetch })).rejects.toMatchObject({
      details: { reason: 'github_provider_payload_invalid', operation: 'installation' },
    });
    expect(cancelled).toBe(true);
  });

  it('does not perform any provider request for an already aborted client', async () => {
    let requests = 0;
    const controller = new AbortController();
    controller.abort();
    await expect(
      verifyGithubRecoveryProvider({
        ...target,
        signal: controller.signal,
        fetch: (() => {
          requests += 1;
          return Promise.resolve(Response.json(installation));
        }) as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toMatchObject({ details: { reason: 'github_recovery_expired' } });
    expect(requests).toBe(0);
  });
});
