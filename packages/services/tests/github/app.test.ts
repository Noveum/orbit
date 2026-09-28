import { beforeEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import {
  exchangeGithubUserCode,
  fetchGithubCheckHeadSnapshot,
  fetchGithubInstallation,
  fetchGithubOpenPullRequests,
  fetchGithubPullRequestHead,
  fetchGithubPullRequestHistory,
  fetchInstalledRepositories,
  forgetGithubInstallationTokens,
  GITHUB_CHECK_HEAD_PAGE_SIZE,
  GITHUB_MAX_CHECK_HEAD_PAGES,
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

describe('fetchGithubOpenPullRequests', () => {
  it('walks every open pull request page and normalizes the fields Orbit stores', async () => {
    const pages: number[] = [];
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_pulls' }), { status: 201 });
      }
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get('page') ?? '1');
      pages.push(page);
      const count = page === 1 ? 100 : 1;
      return new Response(
        JSON.stringify(
          Array.from({ length: count }, (_unused, index) => ({
            id: (page - 1) * 100 + index + 1,
            node_id: `PR_${page}_${index}`,
            number: (page - 1) * 100 + index + 1,
            title: `Pull ${page}-${index}`,
            body: index === 0 ? 'Links ORB-3' : null,
            html_url: `https://github.com/Noveum/orbit/pull/${(page - 1) * 100 + index + 1}`,
            draft: index === 1,
            state: 'open',
            head: { ref: `orb-3-branch-${index}`, sha: `sha-${page}-${index}` },
            base: { ref: 'main' },
            user: { login: 'octocat', id: 500 },
          })),
        ),
        { status: 200 },
      );
    });

    const pulls = await fetchGithubOpenPullRequests({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'Noveum/orbit',
      fetch: fetchImpl,
    });

    expect(pages).toEqual([1, 2]);
    expect(pulls).toHaveLength(101);
    expect(pulls[0]).toEqual({
      externalId: '1',
      nodeId: 'PR_1_0',
      number: 1,
      title: 'Pull 1-0',
      body: 'Links ORB-3',
      url: 'https://github.com/Noveum/orbit/pull/1',
      headRef: 'orb-3-branch-0',
      headSha: 'sha-1-0',
      baseRef: 'main',
      draft: false,
      author: { login: 'octocat', id: 500 },
      createdAt: null,
      updatedAt: null,
    });
  });

  it('keeps an absent pull request id non-identifying', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_pulls' }), { status: 201 });
      }
      return new Response(
        JSON.stringify([
          {
            number: 7,
            title: 'Partial pull request',
            html_url: 'https://github.com/Noveum/orbit/pull/7',
            head: { ref: 'partial' },
            base: { ref: 'main' },
          },
        ]),
        { status: 200 },
      );
    });

    const pulls = await fetchGithubOpenPullRequests({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'Noveum/orbit',
      fetch: fetchImpl,
    });

    expect(pulls[0]?.externalId).toBe('');
  });

  it('rejects an open pull request snapshot that exceeds the pagination bound', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_pulls' }), { status: 201 });
      }
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_unused, index) => ({
            id: index + 1,
            number: index + 1,
            title: `Pull ${index + 1}`,
            html_url: `https://github.com/Noveum/orbit/pull/${index + 1}`,
            head: { ref: `pull-${index + 1}` },
            base: { ref: 'main' },
          })),
        ),
        { status: 200 },
      );
    });

    await expect(
      fetchGithubOpenPullRequests({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'Noveum/orbit',
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/snapshot is incomplete/);
  });
});

describe('fetchGithubPullRequestHead', () => {
  it('loads and validates the authoritative head for one pull request', async () => {
    const requested: string[] = [];
    const fetchImpl = jsonFetch((url) => {
      requested.push(url);
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_pull_head' }), { status: 201 });
      }
      return new Response(
        JSON.stringify({
          number: 17,
          head: { sha: '0123456789abcdef0123456789abcdef01234567' },
          updated_at: '2026-09-01T00:00:04.000Z',
        }),
      );
    });

    const head = await fetchGithubPullRequestHead({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'Noveum/orbit',
      pullRequestNumber: 17,
      fetch: fetchImpl,
    });

    expect(head).toEqual({
      number: 17,
      headSha: '0123456789abcdef0123456789abcdef01234567',
      providerUpdatedAt: '2026-09-01T00:00:04.000Z',
    });
    expect(requested[1]).toEndWith('/repos/Noveum/orbit/pulls/17');
  });

  it('rejects a malformed authoritative pull request head', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_pull_head_invalid' }), { status: 201 });
      }
      return new Response(
        JSON.stringify({ number: 17, head: { sha: 'not-a-sha' }, updated_at: null }),
      );
    });

    await expect(
      fetchGithubPullRequestHead({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'Noveum/orbit',
        pullRequestNumber: 17,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/unexpected payload/);
  });
});

describe('fetchGithubPullRequestHistory', () => {
  it('loads conversation comments, reviews, inline comments, and checks', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_history' }), { status: 201 });
      }
      const path = new URL(url).pathname;
      if (path.endsWith('/issues/7/comments')) {
        return new Response(
          JSON.stringify([
            {
              id: 11,
              body: 'Please add a test.',
              html_url: 'https://github.com/acme/web/pull/7#issuecomment-11',
              user: { login: 'ada', id: 1 },
              created_at: '2026-08-13T01:00:00.000Z',
              updated_at: '2026-08-13T01:00:00.000Z',
            },
          ]),
        );
      }
      if (path.endsWith('/pulls/7/reviews')) {
        return new Response(
          JSON.stringify([
            {
              id: 12,
              state: 'APPROVED',
              body: 'Looks good.',
              html_url: 'https://github.com/acme/web/pull/7#pullrequestreview-12',
              user: { login: 'grace', id: 2 },
              submitted_at: '2026-08-13T02:00:00.000Z',
            },
          ]),
        );
      }
      if (path.endsWith('/pulls/7/comments')) {
        return new Response(
          JSON.stringify([
            {
              id: 13,
              body: 'This can be simpler.',
              html_url: 'https://github.com/acme/web/pull/7#discussion_r13',
              user: { login: 'linus', id: 3 },
              path: 'src/index.ts',
              line: 42,
              created_at: '2026-08-13T03:00:00.000Z',
              updated_at: '2026-08-13T03:00:00.000Z',
            },
          ]),
        );
      }
      if (path.endsWith('/commits/abc123/check-runs')) {
        return new Response(
          JSON.stringify({
            total_count: 1,
            check_runs: [
              {
                id: 14,
                name: 'verify',
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/acme/web/actions/runs/14',
                started_at: '2026-08-13T04:00:00.000Z',
                completed_at: '2026-08-13T05:00:00.000Z',
              },
            ],
          }),
        );
      }
      if (path.endsWith('/commits/abc123/statuses')) {
        return new Response(
          JSON.stringify([
            {
              id: 15,
              state: 'failure',
              context: 'Vercel',
              description: 'Deployment failed',
              target_url: 'https://vercel.com/acme/web/deployment/15',
              creator: { login: 'vercel', id: 4 },
              created_at: '2026-08-13T04:30:00.000Z',
              updated_at: '2026-08-13T05:30:00.000Z',
            },
          ]),
        );
      }
      return new Response('{}', { status: 404 });
    });

    const history = await fetchGithubPullRequestHistory({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'acme/web',
      number: 7,
      headSha: 'abc123',
      fetch: fetchImpl,
    });

    expect(history.map((entry) => entry.type)).toEqual([
      'comment',
      'review',
      'review_comment',
      'checks',
      'checks',
    ]);
    expect(history[2]?.path).toBe('src/index.ts');
    expect(history[2]?.line).toBe(42);
    expect(history[3]?.state).toBe('success');
    expect(history[4]?.body).toBe('Vercel');
    expect(history[4]?.state).toBe('failure');
  });
});

describe('fetchGithubCheckHeadSnapshot', () => {
  const headSha = '0123456789abcdef0123456789abcdef01234567';

  it('normalizes every provider activity and selects one authoritative context per identity', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const parsed = new URL(url);
      const path = parsed.pathname;
      if (path.endsWith(`/commits/${headSha}/check-runs`)) {
        expect(parsed.searchParams.get('filter')).toBe('latest');
        return new Response(
          JSON.stringify({
            total_count: 2,
            check_runs: [
              {
                id: 42,
                head_sha: headSha,
                name: '安全',
                app: { id: 901 },
                status: 'completed',
                conclusion: 'failure',
                html_url: 'https://github.com/acme/web/runs/42',
                details_url: 'https://ci.example.com/runs/42',
                started_at: '2026-08-13T04:00:00.000Z',
                completed_at: '2026-08-13T05:00:00.000Z',
              },
              {
                id: 43,
                head_sha: headSha,
                name: '安全',
                app: { id: 902 },
                status: 'in_progress',
                conclusion: null,
                html_url: 'https://github.com/acme/web/runs/43',
                started_at: '2026-08-13T06:00:00.000Z',
                completed_at: null,
              },
            ],
          }),
        );
      }
      if (path.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(
          JSON.stringify([
            {
              id: 51,
              state: 'failure',
              context: 'Vercel',
              target_url: 'https://vercel.com/acme/web/51',
              creator: { login: 'old-vercel-app', id: 80 },
              created_at: '2026-08-13T05:30:00.000Z',
              updated_at: '2026-08-13T06:00:00.000Z',
            },
            {
              id: 52,
              state: 'success',
              context: 'vercel',
              target_url: 'https://vercel.com/acme/web/52',
              creator: { login: 'new-vercel-app', id: 81 },
              created_at: '2026-08-13T06:30:00.000Z',
              updated_at: '2026-08-13T07:00:00.000Z',
            },
          ]),
        );
      }
      return new Response('{}', { status: 404 });
    });

    const snapshot = await fetchGithubCheckHeadSnapshot({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'acme/web',
      headSha,
      fetch: fetchImpl,
    });

    expect(snapshot.headSha).toBe(headSha);
    expect(snapshot.activities).toHaveLength(4);
    expect(snapshot.activities[0]).toEqual({
      sourceKind: 'check_run',
      contextKey: 'v1:9:check_run3:9016:安全',
      providerObjectId: '42',
      providerRunId: '42',
      providerContext: '安全',
      appId: 901,
      state: 'failure',
      status: 'completed',
      conclusion: 'failure',
      providerUpdatedAt: '2026-08-13T05:00:00.000Z',
      url: 'https://github.com/acme/web/runs/42',
      creator: null,
    });
    expect(snapshot.activities[2]).toEqual({
      sourceKind: 'commit_status',
      contextKey: 'v1:13:commit_status6:vercel',
      providerObjectId: '52',
      providerRunId: null,
      providerContext: 'vercel',
      appId: null,
      state: 'success',
      status: 'success',
      conclusion: 'success',
      providerUpdatedAt: '2026-08-13T07:00:00.000Z',
      url: 'https://vercel.com/acme/web/52',
      creator: { login: 'new-vercel-app', id: 81 },
    });
    expect(snapshot.contexts.map((context) => context.providerObjectId)).toEqual([
      '42',
      '43',
      '52',
    ]);
  });

  it('walks every check-run and commit-status page before returning a snapshot', async () => {
    const checkPages: number[] = [];
    const statusPages: number[] = [];
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get('page') ?? '1');
      if (parsed.pathname.endsWith(`/commits/${headSha}/check-runs`)) {
        checkPages.push(page);
        const count = page === 1 ? 100 : 1;
        return new Response(
          JSON.stringify({
            total_count: 101,
            check_runs: Array.from({ length: count }, (_unused, index) => ({
              id: (page - 1) * 100 + index + 1,
              head_sha: headSha,
              name: `check-${(page - 1) * 100 + index + 1}`,
              app: { id: 901 },
              status: 'completed',
              conclusion: 'success',
              html_url: `https://github.com/acme/web/runs/${(page - 1) * 100 + index + 1}`,
              started_at: '2026-08-13T01:00:00.000Z',
              completed_at: '2026-08-13T02:00:00.000Z',
            })),
          }),
        );
      }
      if (parsed.pathname.endsWith(`/commits/${headSha}/statuses`)) {
        statusPages.push(page);
        const count = page === 1 ? 100 : 1;
        return new Response(
          JSON.stringify(
            Array.from({ length: count }, (_unused, index) => ({
              id: (page - 1) * 100 + index + 1,
              state: 'success',
              context: `status-${(page - 1) * 100 + index + 1}`,
              target_url: null,
              creator: null,
              created_at: '2026-08-13T01:00:00.000Z',
              updated_at: '2026-08-13T02:00:00.000Z',
            })),
          ),
          {
            headers:
              page === 1 ? { link: '<https://api.github.com/statuses?page=2>; rel="next"' } : {},
          },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const snapshot = await fetchGithubCheckHeadSnapshot({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'acme/web',
      headSha,
      fetch: fetchImpl,
    });

    expect(checkPages).toEqual([1, 2]);
    expect(statusPages).toEqual([1, 2]);
    expect(snapshot.activities).toHaveLength(202);
    expect(snapshot.contexts).toHaveLength(202);
  });

  it('stops on a full check-run page when GitHub reports the snapshot is complete', async () => {
    const checkPages: number[] = [];
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const parsed = new URL(url);
      if (parsed.pathname.endsWith(`/commits/${headSha}/check-runs`)) {
        const page = Number(parsed.searchParams.get('page') ?? '1');
        checkPages.push(page);
        if (page > 1) return new Response('{}', { status: 500 });
        return new Response(
          JSON.stringify({
            total_count: 100,
            check_runs: Array.from({ length: 100 }, (_unused, index) => ({
              id: index + 1,
              head_sha: headSha,
              name: `check-${index + 1}`,
              app: { id: 901 },
              status: 'completed',
              conclusion: 'success',
              html_url: `https://github.com/acme/web/runs/${index + 1}`,
              started_at: '2026-08-13T01:00:00.000Z',
              completed_at: '2026-08-13T02:00:00.000Z',
            })),
          }),
        );
      }
      if (parsed.pathname.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(JSON.stringify([]));
      }
      return new Response('{}', { status: 404 });
    });

    const snapshot = await fetchGithubCheckHeadSnapshot({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'acme/web',
      headSha,
      fetch: fetchImpl,
    });

    expect(checkPages).toEqual([1]);
    expect(snapshot.activities).toHaveLength(100);
  });

  it('uses GitHub status ordering when two versions have the same provider timestamp', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${headSha}/check-runs`)) {
        return new Response(JSON.stringify({ total_count: 0, check_runs: [] }));
      }
      if (path.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(
          JSON.stringify([
            {
              id: 70,
              state: 'success',
              context: 'deploy',
              target_url: 'https://deploy.example.com/70',
              creator: { login: 'deployer', id: 8 },
              created_at: '2026-08-13T01:00:00.000Z',
              updated_at: '2026-08-13T02:00:00.000Z',
            },
            {
              id: 71,
              state: 'failure',
              context: 'DEPLOY',
              target_url: 'https://deploy.example.com/71',
              creator: { login: 'deployer', id: 8 },
              created_at: '2026-08-13T01:00:00.000Z',
              updated_at: '2026-08-13T02:00:00Z',
            },
          ]),
        );
      }
      return new Response('{}', { status: 404 });
    });

    const snapshot = await fetchGithubCheckHeadSnapshot({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'acme/web',
      headSha,
      fetch: fetchImpl,
    });

    expect(snapshot.contexts).toHaveLength(1);
    expect(snapshot.contexts[0]?.providerObjectId).toBe('70');
    expect(snapshot.contexts[0]?.state).toBe('success');
  });

  it('rejects a check-run snapshot whose result array is missing', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${headSha}/check-runs`)) {
        return new Response(JSON.stringify({ total_count: 0 }));
      }
      if (path.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(JSON.stringify([]));
      }
      return new Response('{}', { status: 404 });
    });

    await expect(
      fetchGithubCheckHeadSnapshot({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'acme/web',
        headSha,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/unexpected payload/);
  });

  it('rejects a short check-run page that contradicts the provider total', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${headSha}/check-runs`)) {
        return new Response(
          JSON.stringify({
            total_count: 2,
            check_runs: [
              {
                id: 1,
                head_sha: headSha,
                name: 'verify',
                app: { id: 901 },
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/acme/web/runs/1',
                started_at: '2026-08-13T01:00:00.000Z',
                completed_at: '2026-08-13T02:00:00.000Z',
              },
            ],
          }),
        );
      }
      if (path.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(JSON.stringify([]));
      }
      return new Response('{}', { status: 404 });
    });

    await expect(
      fetchGithubCheckHeadSnapshot({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'acme/web',
        headSha,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/incomplete/);
  });

  it.each([
    {
      label: 'app identity',
      checkRun: {
        id: 1,
        head_sha: headSha,
        name: 'verify',
        app: null,
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/acme/web/runs/1',
        started_at: '2026-08-13T01:00:00.000Z',
        completed_at: '2026-08-13T02:00:00.000Z',
      },
    },
    {
      label: 'exact non-empty name',
      checkRun: {
        id: 1,
        head_sha: headSha,
        name: '',
        app: { id: 901 },
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/acme/web/runs/1',
        started_at: '2026-08-13T01:00:00.000Z',
        completed_at: '2026-08-13T02:00:00.000Z',
      },
    },
    {
      label: 'provider timestamp',
      checkRun: {
        id: 1,
        head_sha: headSha,
        name: 'verify',
        app: { id: 901 },
        status: 'queued',
        conclusion: null,
        html_url: 'https://github.com/acme/web/runs/1',
        started_at: null,
        completed_at: null,
      },
    },
  ])('rejects a check run without a valid $label', async ({ checkRun }) => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${headSha}/check-runs`)) {
        return new Response(JSON.stringify({ total_count: 1, check_runs: [checkRun] }));
      }
      if (path.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(JSON.stringify([]));
      }
      return new Response('{}', { status: 404 });
    });

    await expect(
      fetchGithubCheckHeadSnapshot({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'acme/web',
        headSha,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/unexpected payload|identity|timestamp/);
  });

  it('rejects a provider check run that belongs to a different head', async () => {
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const path = new URL(url).pathname;
      if (path.endsWith(`/commits/${headSha}/check-runs`)) {
        return new Response(
          JSON.stringify({
            total_count: 1,
            check_runs: [
              {
                id: 1,
                head_sha: 'abcdef0123456789abcdef0123456789abcdef01',
                name: 'verify',
                app: { id: 901 },
                status: 'completed',
                conclusion: 'success',
                html_url: 'https://github.com/acme/web/runs/1',
                started_at: '2026-08-13T01:00:00.000Z',
                completed_at: '2026-08-13T02:00:00.000Z',
              },
            ],
          }),
        );
      }
      if (path.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(JSON.stringify([]));
      }
      return new Response('{}', { status: 404 });
    });

    await expect(
      fetchGithubCheckHeadSnapshot({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'acme/web',
        headSha,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/different head/);
  });

  it('rejects a snapshot when check-run pagination reaches its safety bound', async () => {
    const checkPages: number[] = [];
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const parsed = new URL(url);
      if (parsed.pathname.endsWith(`/commits/${headSha}/check-runs`)) {
        const page = Number(parsed.searchParams.get('page') ?? '1');
        checkPages.push(page);
        return new Response(
          JSON.stringify({
            total_count: 1001,
            check_runs: Array.from({ length: 100 }, (_unused, index) => ({
              id: (page - 1) * 100 + index + 1,
              head_sha: headSha,
              name: `check-${(page - 1) * 100 + index + 1}`,
              app: { id: 901 },
              status: 'completed',
              conclusion: 'success',
              html_url: `https://github.com/acme/web/runs/${(page - 1) * 100 + index + 1}`,
              started_at: '2026-08-13T01:00:00.000Z',
              completed_at: '2026-08-13T02:00:00.000Z',
            })),
          }),
        );
      }
      if (parsed.pathname.endsWith(`/commits/${headSha}/statuses`)) {
        return new Response(JSON.stringify([]));
      }
      return new Response('{}', { status: 404 });
    });

    await expect(
      fetchGithubCheckHeadSnapshot({
        appId: '123456',
        privateKey,
        installationId: '9001',
        repository: 'acme/web',
        headSha,
        fetch: fetchImpl,
      }),
    ).rejects.toThrow(/snapshot size/);
    expect(checkPages).toHaveLength(GITHUB_MAX_CHECK_HEAD_PAGES);
  });

  it('accepts an exact-bound status snapshot when GitHub reports no next page', async () => {
    const statusPages: number[] = [];
    const fetchImpl = jsonFetch((url) => {
      if (url.includes('access_tokens')) {
        return new Response(JSON.stringify({ token: 'ghs_checks' }), { status: 201 });
      }
      const parsed = new URL(url);
      if (parsed.pathname.endsWith(`/commits/${headSha}/check-runs`)) {
        return new Response(JSON.stringify({ total_count: 0, check_runs: [] }));
      }
      if (parsed.pathname.endsWith(`/commits/${headSha}/statuses`)) {
        const page = Number(parsed.searchParams.get('page') ?? '1');
        statusPages.push(page);
        const headers =
          page < GITHUB_MAX_CHECK_HEAD_PAGES
            ? {
                link: `<https://api.github.com/statuses?page=${page + 1}>; rel="next"`,
              }
            : {};
        return new Response(
          JSON.stringify(
            Array.from({ length: GITHUB_CHECK_HEAD_PAGE_SIZE }, (_unused, index) => ({
              id: (page - 1) * GITHUB_CHECK_HEAD_PAGE_SIZE + index + 1,
              state: 'success',
              context: `status-${(page - 1) * GITHUB_CHECK_HEAD_PAGE_SIZE + index + 1}`,
              target_url: null,
              creator: null,
              created_at: '2026-08-13T01:00:00.000Z',
              updated_at: '2026-08-13T02:00:00.000Z',
            })),
          ),
          { headers },
        );
      }
      return new Response('{}', { status: 404 });
    });

    const snapshot = await fetchGithubCheckHeadSnapshot({
      appId: '123456',
      privateKey,
      installationId: '9001',
      repository: 'acme/web',
      headSha,
      fetch: fetchImpl,
    });

    expect(statusPages).toHaveLength(GITHUB_MAX_CHECK_HEAD_PAGES);
    expect(snapshot.activities).toHaveLength(
      GITHUB_MAX_CHECK_HEAD_PAGES * GITHUB_CHECK_HEAD_PAGE_SIZE,
    );
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

  it('walks every installation page before checking callback ownership', async () => {
    const pages: number[] = [];
    const ids = await listUserInstallationIds({
      userToken: 'ghu_x',
      fetch: jsonFetch((url) => {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        pages.push(page);
        const start = (page - 1) * 100;
        const count = page === 1 ? 100 : 50;
        return new Response(
          JSON.stringify({
            total_count: 150,
            installations: Array.from({ length: count }, (_unused, index) => ({
              id: start + index + 1,
            })),
          }),
          { status: 200 },
        );
      }),
    });

    expect(pages).toEqual([1, 2]);
    expect(ids).toHaveLength(150);
    expect(ids.at(-1)).toBe('150');
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
