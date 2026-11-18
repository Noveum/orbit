import { beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { DomainError } from '@orbit/shared/errors';
import { forgetGithubInstallationTokens } from '../../src/github/app.ts';
import {
  fetchReplacementInstallationProof,
  fetchReplacementRepositoryProof,
  REPLACEMENT_MAX_BODY_BYTES,
  verifyGithubInstallationReplacement,
} from '../../src/github/installation-replacement-proof.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function fakeFetch(
  handler: (
    url: string,
    init: Parameters<typeof globalThis.fetch>[1],
  ) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return Object.assign(
    (...args: Parameters<typeof globalThis.fetch>) => {
      const [input, init] = args;
      const url = input instanceof Request ? input.url : String(input);
      return Promise.resolve(handler(url, init));
    },
    { preconnect: () => undefined },
  );
}

function installation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 9001,
    app_id: 123456,
    account: { id: 42, login: 'fixture-account', type: 'Organization' },
    target_type: 'Organization',
    repository_selection: 'selected',
    suspended_at: null,
    ...overrides,
  };
}

const request = { appId: '123456', privateKey, installationId: '9001' };

beforeEach(() => {
  forgetGithubInstallationTokens();
});

describe('replacement provider proof requirements', () => {
  it('accepts matching positive stable installation and account identities', async () => {
    let calls = 0;
    const value = await fetchReplacementInstallationProof({
      ...request,
      fetch: fakeFetch((url, init) => {
        calls += 1;
        expect(url).toBe('https://api.github.com/app/installations/9001');
        expect(init?.method ?? 'GET').toBe('GET');
        expect(init?.signal instanceof AbortSignal).toBe(true);
        expect(init?.signal?.aborted).toBe(false);
        return Response.json(installation());
      }),
    });
    expect(value.installationId).toBe('9001');
    expect(value.accountId).toBe('42');
    expect(value.suspended).toBe(false);
    expect(calls).toBe(1);
  });

  const invalidMetadata: { label: string; body: Record<string, unknown> }[] = [
    { label: 'another returned installation', body: installation({ id: 9002 }) },
    { label: 'another App', body: installation({ app_id: 987654 }) },
    { label: 'a zero App identity', body: installation({ app_id: 0 }) },
    { label: 'a missing App identity', body: installation({ app_id: undefined }) },
    { label: 'an absent account', body: installation({ account: undefined }) },
    { label: 'a null account', body: installation({ account: null }) },
    {
      label: 'a zero account identity',
      body: installation({ account: { id: 0, login: 'fixture', type: 'Organization' } }),
    },
    {
      label: 'a missing account identity',
      body: installation({ account: { login: 'fixture', type: 'Organization' } }),
    },
    {
      label: 'an unsupported account type',
      body: installation({ account: { id: 42, login: 'fixture', type: 'Unsupported' } }),
    },
    {
      label: 'a negative account identity',
      body: installation({ account: { id: -1, login: 'fixture', type: 'Organization' } }),
    },
    { label: 'a zero installation identity', body: installation({ id: 0 }) },
  ];
  for (const { label, body } of invalidMetadata) {
    it(`rejects ${label} as replacement proof`, async () => {
      await expect(
        fetchReplacementInstallationProof({
          ...request,
          fetch: fakeFetch(() => Response.json(body)),
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  }

  const invalidRequests = [
    { ...request, appId: '0' },
    { ...request, appId: '' },
    { ...request, installationId: '0' },
    { ...request, installationId: '9001/other' },
  ];
  for (const invalid of invalidRequests) {
    it('rejects malformed proof identity before making a provider request', async () => {
      let calls = 0;
      let rejected = false;
      try {
        await fetchReplacementInstallationProof({
          ...invalid,
          fetch: fakeFetch(() => {
            calls += 1;
            return Response.json(installation());
          }),
        });
      } catch {
        rejected = true;
      }
      expect({ rejected, calls }).toEqual({ rejected: true, calls: 0 });
    });
  }

  it('does not follow redirects while proving installation availability', async () => {
    let redirectsRejected = false;
    await fetchReplacementInstallationProof({
      ...request,
      fetch: fakeFetch((_url, init) => {
        redirectsRejected = init?.redirect === 'error';
        return Response.json(installation());
      }),
    });
    expect(redirectsRejected).toBe(true);
  });

  for (const status of [401, 403, 404, 429, 500]) {
    it(`preserves exact HTTP${status} as typed installation evidence`, async () => {
      let failure: unknown;
      try {
        await fetchReplacementInstallationProof({
          ...request,
          fetch: fakeFetch(() =>
            Response.json({ message: 'fixture provider failure' }, { status }),
          ),
        });
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(DomainError);
      if (!(failure instanceof DomainError)) throw new Error('Expected a typed provider failure');
      expect(failure.details).toEqual({
        reason: 'github_provider_http_error',
        operation: 'installation',
        httpStatus: status,
      });
    });
  }

  it('does not infer a missing installation from a successful malformed response', async () => {
    let failure: unknown;
    try {
      await fetchReplacementInstallationProof({
        ...request,
        fetch: fakeFetch(() => Response.json({ message: '404 Not Found' })),
      });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DomainError);
    if (!(failure instanceof DomainError)) throw new Error('Expected invalid provider metadata');
    expect(failure.details?.['httpStatus']).not.toBe(404);
  });

  it('retains a suspended fact for the transactional eligibility gate to reject', async () => {
    const value = await fetchReplacementInstallationProof({
      ...request,
      fetch: fakeFetch(() => Response.json(installation({ suspended_at: '2026-11-17T00:00:00Z' }))),
    });
    expect(value.suspended).toBe(true);
  });

  function repositoryFetch(body: unknown): typeof globalThis.fetch {
    return fakeFetch((url) => {
      const path = new URL(url).pathname;
      if (path === '/app/installations/9001/access_tokens') {
        return Response.json({ token: 'local-replacement-fixture-token' }, { status: 201 });
      }
      expect(path).toBe('/installation/repositories');
      return Response.json(body);
    });
  }

  it('accepts a complete current-token repository snapshot by stable identity', async () => {
    const rows = await fetchReplacementRepositoryProof({
      ...request,
      fetch: repositoryFetch({
        total_count: 2,
        repositories: [
          { id: 11, name: 'renamed', full_name: 'fixture-account/renamed' },
          { id: 12, name: 'two', full_name: 'fixture-account/two' },
        ],
      }),
    });
    expect(rows.map((row) => row.repositoryId)).toEqual(['11', '12']);
  });

  const invalidCatalogues: { label: string; body: unknown }[] = [
    { label: 'missing snapshot fields', body: {} },
    {
      label: 'missing declared total',
      body: { repositories: [{ id: 11, full_name: 'fixture/one' }] },
    },
    { label: 'missing repository collection', body: { total_count: 1 } },
    {
      label: 'a truncated advertised snapshot',
      body: { total_count: 2, repositories: [{ id: 11, full_name: 'fixture/one' }] },
    },
    {
      label: 'a contradictory zero total',
      body: { total_count: 0, repositories: [{ id: 11, full_name: 'fixture/one' }] },
    },
    {
      label: 'duplicate stable repository IDs',
      body: {
        total_count: 2,
        repositories: [
          { id: 11, full_name: 'fixture/one' },
          { id: 11, full_name: 'fixture/duplicate' },
        ],
      },
    },
    {
      label: 'a zero stable repository identity',
      body: { total_count: 1, repositories: [{ id: 0, full_name: 'fixture/zero' }] },
    },
  ];
  for (const { label, body } of invalidCatalogues) {
    it(`rejects ${label} as complete replacement access proof`, async () => {
      await expect(
        fetchReplacementRepositoryProof({
          ...request,
          fetch: repositoryFetch(body),
        }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  }
});

describe('verified replacement orchestration', () => {
  const input = {
    ...request,
    previousInstallationId: '9000',
    expectedAccountId: '42',
    expectedAccountType: 'Organization' as const,
    watchedRepositoryIds: ['11', '12'],
  };

  function provider(
    options: {
      oldStatus?: number;
      newBody?: unknown;
      repositories?: unknown[];
      calls?: string[];
    } = {},
  ): typeof globalThis.fetch {
    return fakeFetch((url) => {
      const path = new URL(url).pathname;
      options.calls?.push(path);
      if (path === '/app/installations/9001')
        return Response.json(options.newBody ?? installation());
      if (path === '/app/installations/9000')
        return Response.json(
          { message: 'fixture unavailable' },
          { status: options.oldStatus ?? 404 },
        );
      if (path === '/app/installations/9001/access_tokens')
        return Response.json({ token: 'local-replacement-fixture-token' }, { status: 201 });
      if (path === '/installation/repositories') {
        const repositories = options.repositories ?? [
          { id: 11, full_name: 'fixture/renamed' },
          { id: 12, full_name: 'fixture/two' },
        ];
        return Response.json({ total_count: repositories.length, repositories });
      }
      throw new Error('Unexpected fake provider route');
    });
  }

  it('proves exact old404 and preserves renamed repository identity without returning credentials', async () => {
    const calls: string[] = [];
    const proof = await verifyGithubInstallationReplacement({
      ...input,
      fetch: provider({ calls }),
    });
    expect(calls).toEqual([
      '/app/installations/9001',
      '/app/installations/9000',
      '/app/installations/9001/access_tokens',
      '/installation/repositories',
    ]);
    expect(Object.keys(proof).sort()).toEqual([
      'installation',
      'previousInstallationId',
      'repositories',
    ]);
    expect(proof.previousInstallationId).toBe('9000');
    expect(proof.repositories.map((row) => row.repositoryId)).toEqual(['11', '12']);
  });

  it('requires uncached requests for every replacement proof stage', async () => {
    const caches: (RequestCache | undefined)[] = [];
    const upstream = provider();
    await verifyGithubInstallationReplacement({
      ...input,
      fetch: fakeFetch((url, init) => {
        caches.push(init?.cache);
        return upstream(url, init);
      }),
    });
    expect(caches).toEqual(['no-store', 'no-store', 'no-store', 'no-store']);
  });

  for (const status of [200, 401, 403, 429, 500]) {
    it(`declines old HTTP${status} instead of treating it as absence`, async () => {
      await expect(
        verifyGithubInstallationReplacement({ ...input, fetch: provider({ oldStatus: status }) }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  }

  it('rejects another stable account even when its login is the same', async () => {
    await expect(
      verifyGithubInstallationReplacement({ ...input, expectedAccountId: '43', fetch: provider() }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects a different account type', async () => {
    await expect(
      verifyGithubInstallationReplacement({
        ...input,
        expectedAccountType: 'User',
        fetch: provider(),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects a suspended replacement', async () => {
    await expect(
      verifyGithubInstallationReplacement({
        ...input,
        fetch: provider({ newBody: installation({ suspended_at: '2026-11-17T00:00:00Z' }) }),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects current-token access that omits any watched stable repository ID', async () => {
    await expect(
      verifyGithubInstallationReplacement({
        ...input,
        fetch: provider({ repositories: [{ id: 11, full_name: 'fixture/renamed' }] }),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  for (const watchedRepositoryIds of [['0'], ['11', '11']]) {
    it('rejects malformed or duplicate watched identities before provider I/O', async () => {
      const calls: string[] = [];
      await expect(
        verifyGithubInstallationReplacement({
          ...input,
          watchedRepositoryIds,
          fetch: provider({ calls }),
        }),
      ).rejects.toBeInstanceOf(DomainError);
      expect(calls).toHaveLength(0);
    });
  }

  it('does not use same-ID ordinary reconnect as replacement proof', async () => {
    const calls: string[] = [];
    await expect(
      verifyGithubInstallationReplacement({
        ...input,
        previousInstallationId: '9001',
        fetch: provider({ calls }),
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(calls).toHaveLength(0);
  });

  it('rejects oversized provider metadata without accepting its valid-looking identity', async () => {
    await expect(
      fetchReplacementInstallationProof({
        ...request,
        fetch: fakeFetch(() =>
          Response.json(installation({ padding: 'x'.repeat(REPLACEMENT_MAX_BODY_BYTES + 1) })),
        ),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('replacement proof resource bounds', () => {
  it('enforces the overall deadline even when response completion wins the timer queue', async () => {
    const original = Object.getOwnPropertyDescriptor(performance, 'now');
    let clock = 0;
    let calls = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
    try {
      await expect(
        verifyGithubInstallationReplacement({
          ...request,
          previousInstallationId: '9000',
          expectedAccountId: '42',
          expectedAccountType: 'Organization',
          watchedRepositoryIds: ['11'],
          fetch: fakeFetch((url) => {
            calls += 1;
            clock += 9000;
            const path = new URL(url).pathname;
            if (path === '/app/installations/9001') return Response.json(installation());
            if (path === '/app/installations/9000') return new Response(null, { status: 404 });
            if (path.endsWith('/access_tokens'))
              return Response.json({ token: 'local-bound-fixture-token' }, { status: 201 });
            return Response.json({
              total_count: 1,
              repositories: [{ id: 11, full_name: 'fixture/one' }],
            });
          }),
        }),
      ).rejects.toMatchObject({ details: { reason: 'github_replacement_timeout' } });
      expect(calls).toBe(4);
    } finally {
      if (original === undefined) Reflect.deleteProperty(performance, 'now');
      else Object.defineProperty(performance, 'now', original);
    }
  });

  it('aborts a provider that never resolves within the request deadline', async () => {
    let aborted = false;
    await expect(
      fetchReplacementInstallationProof({
        ...request,
        fetch: fakeFetch((_url, init) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
            },
            { once: true },
          );
          return new Promise<Response>(() => undefined);
        }),
      }),
    ).rejects.toMatchObject({ details: { reason: 'github_replacement_timeout' } });
    expect(aborted).toBe(true);
  }, 15_000);

  it('cancels a response body that never completes within the request deadline', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      fetchReplacementInstallationProof({
        ...request,
        fetch: fakeFetch(() => new Response(stream)),
      }),
    ).rejects.toMatchObject({ details: { reason: 'github_replacement_timeout' } });
    expect(cancelled).toBe(true);
  }, 15_000);

  it('bounds actual streamed bytes even when content-length understates the body', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(REPLACEMENT_MAX_BODY_BYTES + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      fetchReplacementInstallationProof({
        ...request,
        fetch: fakeFetch(() => new Response(stream, { headers: { 'content-length': '1' } })),
      }),
    ).rejects.toMatchObject({ details: { reason: 'github_replacement_body_limit' } });
    expect(cancelled).toBe(true);
  });

  it('rejects invalid JSON without returning raw provider content', async () => {
    let failure: unknown;
    try {
      await fetchReplacementInstallationProof({
        ...request,
        fetch: fakeFetch(() => new Response('fixture-private-provider-body-not-json')),
      });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DomainError);
    if (!(failure instanceof DomainError)) throw new Error('Expected safe provider error');
    expect(failure.message).not.toContain('fixture-private-provider-body');
    expect(failure.details).toEqual({
      reason: 'github_replacement_invalid_payload',
      operation: 'installation',
    });
  });

  it('collects all complete repository pages using a fresh token each time', async () => {
    let tokens = 0;
    const pages: number[] = [];
    const fetch = fakeFetch((url) => {
      if (new URL(url).pathname.endsWith('/access_tokens')) {
        tokens += 1;
        return Response.json({ token: 'local-pages-fixture-token' }, { status: 201 });
      }
      const page = Number(new URL(url).searchParams.get('page'));
      pages.push(page);
      return Response.json({
        total_count: 101,
        repositories: Array.from({ length: page === 1 ? 100 : 1 }, (_value, index) => ({
          id: (page - 1) * 100 + index + 1,
          full_name: `fixture/repository-${(page - 1) * 100 + index + 1}`,
        })),
      });
    });
    expect(await fetchReplacementRepositoryProof({ ...request, fetch })).toHaveLength(101);
    expect(await fetchReplacementRepositoryProof({ ...request, fetch })).toHaveLength(101);
    expect(tokens).toBe(2);
    expect(pages).toEqual([1, 2, 1, 2]);
  });

  it('rejects a changing declared total instead of accepting a mixed catalogue', async () => {
    const fetch = fakeFetch((url) => {
      if (new URL(url).pathname.endsWith('/access_tokens'))
        return Response.json({ token: 'local-changing-fixture-token' }, { status: 201 });
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({
        total_count: page === 1 ? 101 : 102,
        repositories: Array.from({ length: page === 1 ? 100 : 2 }, (_value, index) => ({
          id: (page - 1) * 100 + index + 1,
          full_name: `fixture/repository-${(page - 1) * 100 + index + 1}`,
        })),
      });
    });
    await expect(fetchReplacementRepositoryProof({ ...request, fetch })).rejects.toMatchObject({
      details: { reason: 'github_replacement_incomplete_catalogue' },
    });
  });

  it('rejects an advertised catalogue beyond the fixed page bound before reading unbounded pages', async () => {
    let pages = 0;
    const fetch = fakeFetch((url) => {
      if (new URL(url).pathname.endsWith('/access_tokens'))
        return Response.json({ token: 'local-max-fixture-token' }, { status: 201 });
      pages += 1;
      return Response.json({
        total_count: 10001,
        repositories: [{ id: 11, full_name: 'fixture/one' }],
      });
    });
    await expect(fetchReplacementRepositoryProof({ ...request, fetch })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(pages).toBe(1);
  });
});
