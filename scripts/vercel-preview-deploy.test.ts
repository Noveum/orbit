import { describe, expect, test } from 'bun:test';
import type { PreviewRuntime } from './vercel-preview-deploy.ts';
import { reconcileVercelPreviews } from './vercel-preview-deploy.ts';

const SHA = 'a'.repeat(40);
const NEW_SHA = 'c'.repeat(40);
const MAIN_SHA = 'b'.repeat(40);
const GITHUB_TOKEN = 'github-secret-token';
const VERCEL_TOKEN = 'vercel-secret-token';

type RecordedRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
  readonly signal: AbortSignal | null;
};

type Scenario = {
  eventName?: string;
  event?: unknown;
  pullRequest?: Record<string, unknown>;
  files?: readonly (string | Record<string, unknown>)[];
  workflowRuns?: readonly Record<string, unknown>[];
  deployments?: readonly Record<string, unknown>[];
  detailStates?: readonly string[];
  respond?: (
    request: RecordedRequest,
    requestNumber: number,
  ) => Response | Promise<Response> | undefined;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  scheduleTimeout?: (callback: () => void, milliseconds: number) => () => void;
};

const repository = {
  id: 123,
  name: 'orbit',
  owner: { login: 'Noveum' },
};

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 341,
    state: 'open',
    draft: false,
    labels: [],
    user: { login: 'maintainer' },
    head: { sha: SHA, ref: 'feature/preview', repo: repository },
    base: { ref: 'main', repo: repository },
    ...overrides,
  };
}

function workflowRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 987654321,
    workflow_id: 456,
    name: 'CI',
    event: 'pull_request',
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-21T00:00:00Z',
    pull_requests: [
      {
        number: 341,
        head: { sha: SHA, ref: 'feature/preview', repo: { id: 123, name: 'orbit' } },
        base: { sha: MAIN_SHA, ref: 'main', repo: { id: 123, name: 'orbit' } },
      },
    ],
    ...overrides,
  };
}

function workflowRunEvent(overrides: Record<string, unknown> = {}) {
  return {
    action: 'completed',
    repository,
    workflow_run: workflowRun(),
    ...overrides,
  };
}

function deployment(
  readyState: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uid: `dpl_${readyState.toLowerCase()}`,
    projectId: 'prj_orbit',
    url: readyState === 'READY' ? 'orbit-preview.vercel.app' : null,
    target: null,
    readyState,
    meta: {
      orbitDeploymentReason: 'ci-green-pr-preview',
      orbitGithubHeadRef: 'feature/preview',
      orbitGithubHeadSha: SHA,
      orbitGithubPrNumber: '341',
      orbitGithubRepositoryId: '123',
      orbitGithubWorkflowRunId: '987654321',
    },
    ...overrides,
  };
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    orbitDeploymentReason: 'ci-green-pr-preview',
    orbitGithubHeadRef: 'feature/preview',
    orbitGithubHeadSha: SHA,
    orbitGithubPrNumber: '341',
    orbitGithubRepositoryId: '123',
    orbitGithubWorkflowRunId: '987654321',
    ...overrides,
  };
}

function mutationDeployment(
  id: string,
  readyState: string,
  overrides: Record<string, unknown> = {},
) {
  const listed = deployment(readyState, { uid: id, ...overrides });
  const { uid: _uid, ...rest } = listed;
  return { id, ...rest, url: 'orbit-preview.vercel.app' };
}

function vercelProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prj_orbit',
    name: 'orbit',
    accountId: 'team_orbit',
    ...overrides,
  };
}

function json(value: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function unreadableJson(message: string): Response {
  const response = json({ message: 'unreadable' });
  Object.defineProperty(response, 'text', {
    value: () => Promise.reject(new Error(message)),
  });
  return response;
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return String(error);
  }
}

function createHarness(scenario: Scenario = {}) {
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  const currentPullRequest = scenario.pullRequest ?? pullRequest();
  const event =
    scenario.event ??
    (scenario.eventName === 'repository_dispatch'
      ? {
          action: 'vercel-preview-reconcile',
          client_payload: { pull_request: 341 },
          repository,
        }
      : workflowRunEvent());
  const detailStates = [...(scenario.detailStates ?? ['READY'])];

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    await Promise.resolve();
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const request = { method, url, headers, body, signal: init?.signal ?? null };
    requests.push(request);
    const customResponse = await scenario.respond?.(request, requests.length);
    if (customResponse) return customResponse;

    if (url.includes('/pulls/341/files')) {
      return json(
        (scenario.files ?? ['apps/web/src/app/page.tsx']).map((file) =>
          typeof file === 'string' ? { filename: file, status: 'modified' } : file,
        ),
      );
    }
    if (url.endsWith('/pulls/341')) return json(currentPullRequest);
    if (url.endsWith('/actions/workflows/ci.yml')) {
      return json({ id: 456, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' });
    }
    if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: MAIN_SHA } });
    if (url.includes('/actions/workflows/456/runs')) {
      const runs = scenario.workflowRuns ?? [workflowRun()];
      return json({ total_count: runs.length, workflow_runs: runs });
    }
    if (url.includes('/v9/projects/')) return json(vercelProject());
    if (url.includes('/v7/deployments')) {
      const deployments = scenario.deployments ?? [];
      return json({
        deployments,
        pagination: { count: deployments.length, next: null, prev: null },
      });
    }
    if (url.includes('/v13/deployments/') && method === 'GET') {
      const id = url.split('/').at(-1)?.split('?')[0] ?? 'dpl_created';
      return json(mutationDeployment(id, detailStates.shift() ?? 'READY'));
    }
    if (url.includes('/v13/deployments') && method === 'POST') {
      return json(mutationDeployment('dpl_created', 'QUEUED'));
    }
    if (url.includes('/cancel') && method === 'PATCH') {
      const id = url.split('/').at(-2) ?? 'dpl_building';
      return json(mutationDeployment(id, 'CANCELED'));
    }
    return json({ message: 'unexpected request' }, 500);
  };

  const runtime: PreviewRuntime = {
    env: {
      GITHUB_EVENT_NAME: scenario.eventName ?? 'workflow_run',
      GITHUB_EVENT_PATH: '/event.json',
      GITHUB_REPOSITORY: 'Noveum/orbit',
      GITHUB_TOKEN,
      VERCEL_TOKEN,
      VERCEL_TEAM_ID: 'team_orbit',
      VERCEL_PROJECT_ID: 'prj_orbit',
      VERCEL_PROJECT_NAME: 'orbit',
    },
    readText: async () => JSON.stringify(event),
    fetch,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      await scenario.sleep?.(milliseconds);
    },
    scheduleTimeout:
      scenario.scheduleTimeout ??
      ((callback, milliseconds) => {
        const timeout = setTimeout(callback, milliseconds);
        return () => clearTimeout(timeout);
      }),
    now: scenario.now ?? (() => Date.parse('2026-08-21T00:00:00Z')),
    log: (message) => {
      logs.push(message);
    },
  };

  return { runtime, requests, sleeps, logs };
}

describe('event and eligibility reconciliation', () => {
  test('successful workflow_run for the current ready head creates one deployment', async () => {
    const harness = createHarness();

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'created',
        pullRequestNumber: 341,
        reason: 'created-ready',
        deploymentId: 'dpl_created',
        url: 'orbit-preview.vercel.app',
      },
    ]);
    const creates = harness.requests.filter(
      ({ method, url }) => method === 'POST' && url.includes('/v13/deployments'),
    );
    expect(creates).toHaveLength(1);
    const createRequest = creates[0];
    if (createRequest === undefined) {
      throw new Error('Expected one Vercel deployment creation request');
    }
    expect(createRequest.method).toBe('POST');
    expect(createRequest.url).toContain('/v13/deployments');
    expect(createRequest.url).not.toContain('forceNew=1');
    expect(createRequest.body).toEqual({
      name: 'orbit',
      project: 'prj_orbit',
      gitSource: { type: 'github', repoId: 123, ref: 'feature/preview', sha: SHA },
      meta: {
        orbitDeploymentReason: 'ci-green-pr-preview',
        orbitGithubHeadRef: 'feature/preview',
        orbitGithubHeadSha: SHA,
        orbitGithubPrNumber: '341',
        orbitGithubRepositoryId: '123',
        orbitGithubWorkflowRunId: '987654321',
      },
    });
    expect(createRequest.body).not.toHaveProperty('target');
    const projectLookupIndex = harness.requests.findIndex(
      ({ method, url }) => method === 'GET' && url.includes('/v9/projects/prj_orbit'),
    );
    expect(projectLookupIndex).toBeGreaterThanOrEqual(0);
    expect(projectLookupIndex).toBeLessThan(harness.requests.indexOf(createRequest));
    expect(
      new URL(harness.requests[projectLookupIndex]?.url ?? '').searchParams.get('teamId'),
    ).toBe('team_orbit');
    expect(
      harness.requests.filter(
        ({ method, url }) => method === 'GET' && url.includes('/v9/projects/'),
      ),
    ).toHaveLength(1);
  });

  test('repository_dispatch follows current eligibility and exact CI proof', async () => {
    const harness = createHarness({ eventName: 'repository_dispatch' });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({ kind: 'created', reason: 'created-ready' });
  });

  test.each([
    ['ready pull request', false, []],
    ['preview-labeled draft', true, [{ name: 'preview' }]],
  ])('%s state event creates after exact CI success', async (_name, draft, labels) => {
    const embeddedPullRequest = pullRequest({ draft, labels });
    const harness = createHarness({
      eventName: 'pull_request_target',
      event: {
        action: draft ? 'labeled' : 'ready_for_review',
        number: 341,
        pull_request: embeddedPullRequest,
        repository,
      },
      pullRequest: embeddedPullRequest,
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({ kind: 'created', reason: 'created-ready' });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  test.each(['closed', 'converted_to_draft', 'labeled'])(
    '%s state transition cancels active deployments without CI',
    async (action) => {
      const livePullRequest = pullRequest({
        state: action === 'closed' ? 'closed' : 'open',
        draft: action === 'converted_to_draft',
        labels: action === 'labeled' ? [{ name: 'no-preview' }] : [],
      });
      const harness = createHarness({
        eventName: 'pull_request_target',
        event: { action, number: 341, pull_request: livePullRequest, repository },
        pullRequest: livePullRequest,
        deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      });

      const results = await reconcileVercelPreviews(harness.runtime);

      expect(results).toEqual([
        {
          kind: 'canceled',
          pullRequestNumber: 341,
          reason: 'canceled-active',
          deploymentId: 'dpl_active',
          url: 'orbit-preview.vercel.app',
        },
      ]);
      expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
      expect(harness.requests.some(({ url }) => url.includes('/actions/workflows/'))).toBe(false);
    },
  );

  test.each([
    ['draft without preview', { draft: true }, 'no-active-deployment'],
    [
      'mixed case no-preview wins',
      { labels: [{ name: 'PrEvIeW' }, { name: 'No-PrEvIeW' }] },
      'no-active-deployment',
    ],
    ['wrong base branch', { base: { ref: 'release', repo: repository } }, 'base-mismatch'],
  ] as const)('%s eligibility creates no deployment', async (_name, overrides, reason) => {
    const harness = createHarness({ pullRequest: pullRequest(overrides) });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason }]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test.each([
    ['failed', 'completed', 'failure', 'ci-not-green'],
    ['in-progress', 'in_progress', null, 'ci-not-green'],
  ] as const)('%s CI creates no deployment', async (_name, status, conclusion, reason) => {
    const harness = createHarness({ workflowRuns: [workflowRun({ status, conclusion })] });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason }]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test('unrelated files create no deployment', async () => {
    const harness = createHarness({ files: ['docs/README.md'] });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'web-unaffected' },
    ]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test.each([
    [
      'into a web path',
      {
        filename: 'apps/web/src/feature.ts',
        status: 'renamed',
        previous_filename: 'docs/feature.ts',
      },
    ],
    [
      'out of a web path',
      {
        filename: 'docs/feature.ts',
        status: 'renamed',
        previous_filename: 'apps/web/src/feature.ts',
      },
    ],
  ])('a rename %s creates a deployment', async (_name, file) => {
    const harness = createHarness({ files: [file] });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({ kind: 'created', reason: 'created-ready' });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  test('a malformed rename fails closed before Vercel mutation', async () => {
    const harness = createHarness({
      files: [{ filename: 'apps/web/src/feature.ts', status: 'renamed' }],
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('schema');
    expect(harness.requests.some(({ method }) => method === 'POST' || method === 'PATCH')).toBe(
      false,
    );
  });

  test('stale event SHA cannot create or cancel the current head', async () => {
    const event = workflowRunEvent({ workflow_run: workflowRun({ head_sha: 'c'.repeat(40) }) });
    const harness = createHarness({ event });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'stale-event' }]);
    expect(harness.requests.some(({ method }) => method === 'POST' || method === 'PATCH')).toBe(
      false,
    );
  });

  test('fork heads create no deployment', async () => {
    const harness = createHarness({
      pullRequest: pullRequest({
        head: {
          sha: SHA,
          ref: 'feature/preview',
          repo: { id: 999, name: 'orbit', owner: { login: 'contributor' } },
        },
      }),
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'fork-pull-request' },
    ]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test('a Dependabot workflow run cannot deploy a same-repository pull request', async () => {
    const harness = createHarness({
      pullRequest: pullRequest({ user: { login: 'dependabot[bot]' } }),
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'fork-pull-request' },
    ]);
    expect(harness.requests.some(({ url }) => url.startsWith('https://api.vercel.com'))).toBe(
      false,
    );
  });

  test('a newer non-green run blocks an older success', async () => {
    const harness = createHarness({
      workflowRuns: [
        workflowRun(),
        workflowRun({
          id: 987654322,
          created_at: '2026-08-21T00:01:00Z',
          status: 'queued',
          conclusion: null,
        }),
      ],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'ci-not-green' }]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test('event repository identity must match the configured and live repository', async () => {
    const harness = createHarness({
      event: workflowRunEvent({
        repository: { ...repository, id: 999, name: 'other' },
      }),
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'repository-mismatch' },
    ]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test('a pull request target event rejects disagreement between event numbers', async () => {
    const harness = createHarness({
      eventName: 'pull_request_target',
      event: {
        action: 'opened',
        number: 342,
        pull_request: pullRequest(),
        repository,
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('event pull request');
  });

  test('an empty workflow run association logs a closed reason without inventing a candidate', async () => {
    const event = workflowRunEvent({ workflow_run: workflowRun({ pull_requests: [] }) });
    const harness = createHarness({ event });

    await expect(reconcileVercelPreviews(harness.runtime)).resolves.toEqual([]);
    expect(harness.logs).toContain('workflow-run-unassociated');
  });
});

describe('existing deployments, cancellation, and pagination', () => {
  test.each(['QUEUED', 'INITIALIZING', 'BUILDING'])(
    'existing exact %s deployment is polled without a duplicate create',
    async (readyState) => {
      const harness = createHarness({
        deployments: [deployment(readyState, { uid: 'dpl_active' })],
      });

      const results = await reconcileVercelPreviews(harness.runtime);

      expect(results).toEqual([
        {
          kind: 'created',
          pullRequestNumber: 341,
          reason: 'active-deployment-reused',
          deploymentId: 'dpl_active',
          url: 'orbit-preview.vercel.app',
        },
      ]);
      expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
    },
  );

  test('existing exact ready deployment wins over active and terminal duplicates', async () => {
    const harness = createHarness({
      deployments: [
        deployment('ERROR', { uid: 'dpl_error' }),
        deployment('BUILDING', { uid: 'dpl_active' }),
        deployment('READY', { uid: 'dpl_ready' }),
      ],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'created',
        pullRequestNumber: 341,
        reason: 'ready-deployment-reused',
        deploymentId: 'dpl_ready',
        url: 'orbit-preview.vercel.app',
      },
    ]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
    expect(harness.requests.some(({ url }) => url.includes('/v13/deployments/'))).toBe(false);
  });

  test.each(['CANCELED', 'ERROR', 'BLOCKED', 'DELETED'])(
    'existing terminal %s deployment allows one forced create',
    async (readyState) => {
      const harness = createHarness({
        deployments: [deployment(readyState, { uid: 'dpl_terminal' })],
      });

      await reconcileVercelPreviews(harness.runtime);

      const creates = harness.requests.filter(({ method }) => method === 'POST');
      expect(creates).toHaveLength(1);
      expect(creates[0]?.url).toContain('forceNew=1');
    },
  );

  test.each([
    ['another project', { projectId: 'prj_other' }],
    ['staging target', { target: 'staging' }],
    ['production target', { target: 'production' }],
    ['missing target', { target: undefined }],
    ['another repository', { meta: metadata({ orbitGithubRepositoryId: '999' }) }],
    ['another pull request', { meta: metadata({ orbitGithubPrNumber: '342' }) }],
    ['another ref', { meta: metadata({ orbitGithubHeadRef: 'other' }) }],
  ])('%s does not suppress an exact-SHA create', async (_name, overrides) => {
    const harness = createHarness({ deployments: [deployment('READY', overrides)] });

    await reconcileVercelPreviews(harness.runtime);

    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  test('an unrelated list item without metadata is ignored', async () => {
    const harness = createHarness({
      deployments: [
        {
          uid: 'dpl_unrelated',
          projectId: 'prj_orbit',
          url: null,
          target: null,
          readyState: 'READY',
        },
      ],
    });

    await reconcileVercelPreviews(harness.runtime);

    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  test('Vercel pagination preserves filters and finds exact deployment on page two', async () => {
    let listPage = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/v7/deployments')) return undefined;
        if (!new URL(url).searchParams.has('sha')) {
          return json({ deployments: [], pagination: { count: 0, next: null, prev: null } });
        }
        listPage += 1;
        if (listPage === 1) {
          return json({ deployments: [], pagination: { count: 0, next: 123, prev: null } });
        }
        return json({
          deployments: [deployment('READY', { uid: 'dpl_page_two' })],
          pagination: { count: 1, next: null, prev: 123 },
        });
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({
      reason: 'ready-deployment-reused',
      deploymentId: 'dpl_page_two',
    });
    const pages = harness.requests.filter(({ url }) => url.includes('/v7/deployments'));
    const exactHeadPages = pages.filter(({ url }) => new URL(url).searchParams.has('sha'));
    expect(pages).toHaveLength(3);
    expect(exactHeadPages).toHaveLength(2);
    for (const request of pages) {
      const url = new URL(request.url);
      expect(url.searchParams.get('teamId')).toBe('team_orbit');
      expect(url.searchParams.get('projectId')).toBe('prj_orbit');
      expect(url.searchParams.get('branch')).toBe('feature/preview');
      expect(url.searchParams.get('limit')).toBe('100');
    }
    for (const request of exactHeadPages) {
      expect(new URL(request.url).searchParams.get('sha')).toBe(SHA);
    }
    expect(new URL(exactHeadPages[1]?.url ?? '').searchParams.get('until')).toBe('123');
  });

  test('an exact active deployment wins over terminal history', async () => {
    const harness = createHarness({
      deployments: [
        deployment('ERROR', { uid: 'dpl_error' }),
        deployment('BUILDING', { uid: 'dpl_active' }),
      ],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({
      reason: 'active-deployment-reused',
      deploymentId: 'dpl_active',
    });
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test('a ready list item with a null URL reads validated detail', async () => {
    const harness = createHarness({
      deployments: [deployment('READY', { uid: 'dpl_ready', url: null })],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({
      reason: 'ready-deployment-reused',
      deploymentId: 'dpl_ready',
      url: 'orbit-preview.vercel.app',
    });
    expect(
      harness.requests.filter(({ url }) => url.includes('/v13/deployments/dpl_ready')),
    ).toHaveLength(1);
  });

  test('ineligible state cancels only matching active Preview deployments in ID order', async () => {
    const livePullRequest = pullRequest({ draft: true });
    const matching = deployment('BUILDING', { uid: 'dpl_b' });
    const alsoMatching = deployment('QUEUED', { uid: 'dpl_a' });
    const harness = createHarness({
      pullRequest: livePullRequest,
      deployments: [
        matching,
        deployment('READY', { uid: 'dpl_ready' }),
        deployment('ERROR', { uid: 'dpl_error' }),
        deployment('BUILDING', { uid: 'dpl_stage', target: 'staging' }),
        deployment('BUILDING', { uid: 'dpl_project', projectId: 'prj_other' }),
        deployment('BUILDING', {
          uid: 'dpl_repo',
          meta: metadata({ orbitGithubRepositoryId: '999' }),
        }),
        alsoMatching,
      ],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results.map((result) => result.kind === 'canceled' && result.deploymentId)).toEqual([
      'dpl_a',
      'dpl_b',
    ]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(2);
  });

  test('synchronize cancels only validated active prior heads and retains ready history', async () => {
    const currentPullRequest = pullRequest({
      head: { sha: NEW_SHA, ref: 'feature/preview', repo: repository },
    });
    const harness = createHarness({
      eventName: 'pull_request_target',
      event: {
        action: 'synchronize',
        number: 341,
        pull_request: currentPullRequest,
        repository,
      },
      pullRequest: currentPullRequest,
      workflowRuns: [],
      deployments: [
        deployment('BUILDING', { uid: 'dpl_prior' }),
        deployment('READY', { uid: 'dpl_prior_ready' }),
        deployment('BUILDING', {
          uid: 'dpl_current',
          meta: metadata({ orbitGithubHeadSha: NEW_SHA }),
        }),
        deployment('BUILDING', { uid: 'dpl_project', projectId: 'prj_other' }),
        deployment('BUILDING', {
          uid: 'dpl_repository',
          meta: metadata({ orbitGithubRepositoryId: '999' }),
        }),
        deployment('BUILDING', {
          uid: 'dpl_pull_request',
          meta: metadata({ orbitGithubPrNumber: '342' }),
        }),
        deployment('BUILDING', {
          uid: 'dpl_ref',
          meta: metadata({ orbitGithubHeadRef: 'feature/other' }),
        }),
        deployment('BUILDING', {
          uid: 'dpl_malformed_sha',
          meta: metadata({ orbitGithubHeadSha: 'not-a-sha' }),
        }),
      ],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'canceled',
        pullRequestNumber: 341,
        reason: 'canceled-active',
        deploymentId: 'dpl_prior',
        url: 'orbit-preview.vercel.app',
      },
      { kind: 'skipped', pullRequestNumber: 341, reason: 'ci-unavailable' },
    ]);
    expect(
      harness.requests
        .filter(({ method }) => method === 'PATCH')
        .map(({ url }) => url.split('/').at(-2)),
    ).toEqual(['dpl_prior']);
    expect(
      harness.requests.some(({ url }) => url.includes('/v13/deployments/dpl_prior_ready')),
    ).toBe(false);
  });

  test('repository dispatch recovers an active deployment left by a prior head', async () => {
    const currentPullRequest = pullRequest({
      head: { sha: NEW_SHA, ref: 'feature/preview', repo: repository },
    });
    const harness = createHarness({
      eventName: 'repository_dispatch',
      pullRequest: currentPullRequest,
      workflowRuns: [],
      deployments: [deployment('BUILDING', { uid: 'dpl_prior' })],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'canceled',
        pullRequestNumber: 341,
        reason: 'canceled-active',
        deploymentId: 'dpl_prior',
        url: 'orbit-preview.vercel.app',
      },
      { kind: 'skipped', pullRequestNumber: 341, reason: 'ci-unavailable' },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
  });

  test('cancellation reversal reports that the pull request became eligible', async () => {
    let pullRequestReads = 0;
    const harness = createHarness({
      pullRequest: pullRequest({ draft: true }),
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullRequestReads += 1;
        return json(pullRequest({ draft: pullRequestReads === 1 }));
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'preview-eligible' },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
  });

  test('eligibility changing during project validation prevents cancellation', async () => {
    let projectValidated = false;
    const harness = createHarness({
      pullRequest: pullRequest({ draft: true }),
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ url }) => {
        if (url.includes('/v9/projects/')) {
          projectValidated = true;
          return json(vercelProject());
        }
        if (url.endsWith('/pulls/341')) {
          return json(pullRequest({ draft: !projectValidated }));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'preview-eligible' },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
  });

  test('head changing during project validation prevents prior-head cancellation', async () => {
    let projectValidated = false;
    const currentPullRequest = pullRequest({
      head: { sha: NEW_SHA, ref: 'feature/preview', repo: repository },
    });
    const harness = createHarness({
      eventName: 'repository_dispatch',
      pullRequest: currentPullRequest,
      workflowRuns: [],
      deployments: [deployment('BUILDING', { uid: 'dpl_prior' })],
      respond: ({ url }) => {
        if (url.includes('/v9/projects/')) {
          projectValidated = true;
          return json(vercelProject());
        }
        if (url.endsWith('/pulls/341')) {
          return json(
            projectValidated
              ? pullRequest({
                  head: { sha: 'd'.repeat(40), ref: 'feature/preview', repo: repository },
                })
              : currentPullRequest,
          );
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'stale-event' }]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
  });

  test('eligibility changing after the first cancellation prevents a second PATCH', async () => {
    let canceled = false;
    const harness = createHarness({
      pullRequest: pullRequest({ draft: true }),
      deployments: [
        deployment('BUILDING', { uid: 'dpl_b' }),
        deployment('BUILDING', { uid: 'dpl_a' }),
      ],
      respond: ({ method, url }) => {
        if (url.endsWith('/pulls/341')) {
          return json(pullRequest({ draft: !canceled }));
        }
        if (method === 'PATCH') {
          const id = url.split('/').at(-2) ?? 'missing';
          canceled = true;
          return json(mutationDeployment(id, 'CANCELED'));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'canceled',
        pullRequestNumber: 341,
        reason: 'canceled-active',
        deploymentId: 'dpl_a',
        url: 'orbit-preview.vercel.app',
      },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
    expect(harness.requests.filter(({ url }) => url.endsWith('/pulls/341'))).toHaveLength(4);
  });

  test('cancel 400 accepts a terminal detail race without retrying PATCH', async () => {
    const livePullRequest = pullRequest({ draft: true });
    const harness = createHarness({
      pullRequest: livePullRequest,
      deployments: [deployment('BUILDING', { uid: 'dpl_race' })],
      respond: ({ method, url }) => {
        if (method === 'PATCH') return json({ message: 'not cancelable' }, 400);
        if (url.includes('/v13/deployments/dpl_race')) {
          return json(mutationDeployment('dpl_race', 'READY'));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'no-active-deployment' },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
    expect(
      harness.requests.filter(({ url }) => url.includes('/v13/deployments/dpl_race')),
    ).toHaveLength(1);
  });

  test.each(['network', '429', '503', 'invalid-success'])(
    'ambiguous cancel %s sends one PATCH and reconciles through one detail read',
    async (outcome) => {
      const harness = createHarness({
        pullRequest: pullRequest({ draft: true }),
        deployments: [deployment('BUILDING', { uid: 'dpl_race' })],
        detailStates: ['CANCELED'],
        respond: ({ method }) => {
          if (method !== 'PATCH') return undefined;
          if (outcome === 'network') throw new Error(`${GITHUB_TOKEN} ${VERCEL_TOKEN}`);
          if (outcome === '429') return json({ message: VERCEL_TOKEN }, 429);
          if (outcome === '503') return json({ message: GITHUB_TOKEN }, 503);
          return new Response('{', { status: 200 });
        },
      });

      const results = await reconcileVercelPreviews(harness.runtime);

      expect(results).toEqual([
        { kind: 'skipped', pullRequestNumber: 341, reason: 'no-active-deployment' },
      ]);
      expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
      expect(
        harness.requests.filter(({ url }) => url.includes('/v13/deployments/dpl_race')),
      ).toHaveLength(1);
      expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
      expect(harness.sleeps).toHaveLength(0);
    },
  );

  test('a second reconciliation reuses the deployment created by the first', async () => {
    const stored: Record<string, unknown>[] = [];
    const harness = createHarness({
      respond: ({ method, url }) => {
        if (url.includes('/v7/deployments')) {
          return json({
            deployments: stored,
            pagination: { count: stored.length, next: null, prev: null },
          });
        }
        if (method === 'POST') {
          stored.push(deployment('READY', { uid: 'dpl_created' }));
          return json(mutationDeployment('dpl_created', 'READY'));
        }
        return undefined;
      },
    });

    await reconcileVercelPreviews(harness.runtime);
    const second = await reconcileVercelPreviews(harness.runtime);

    expect(second[0]).toMatchObject({ reason: 'ready-deployment-reused' });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });
});

describe('endpoint pagination and final freshness', () => {
  test('workflow runs paginate to total_count and a newer page-two run blocks creation', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      workflowRun({ id: index + 1, created_at: '2026-08-20T00:00:00Z' }),
    );
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/actions/workflows/456/runs')) return undefined;
        const page = new URL(url).searchParams.get('page');
        return page === '1'
          ? json({ total_count: 101, workflow_runs: firstPage })
          : json({
              total_count: 101,
              workflow_runs: [
                workflowRun({
                  id: 999,
                  created_at: '2026-08-22T00:00:00Z',
                  status: 'queued',
                  conclusion: null,
                }),
              ],
            });
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'ci-not-green' }]);
    expect(
      harness.requests.filter(({ url }) => url.includes('/actions/workflows/456/runs')),
    ).toHaveLength(2);
  });

  test('workflow run pages reject duplicate IDs across pages', async () => {
    const page = Array.from({ length: 100 }, (_, index) => workflowRun({ id: index + 1 }));
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/actions/workflows/456/runs')) return undefined;
        const pageNumber = new URL(url).searchParams.get('page');
        return pageNumber === '1'
          ? json({ total_count: 101, workflow_runs: page })
          : json({ total_count: 101, workflow_runs: [workflowRun({ id: 1 })] });
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('duplicate');
  });

  test('workflow run pages reject inconsistent total_count', async () => {
    const page = Array.from({ length: 100 }, (_, index) => workflowRun({ id: index + 1 }));
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/actions/workflows/456/runs')) return undefined;
        const pageNumber = new URL(url).searchParams.get('page');
        return pageNumber === '1'
          ? json({ total_count: 101, workflow_runs: page })
          : json({ total_count: 102, workflow_runs: [workflowRun({ id: 101 })] });
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('total_count');
  });

  test('pull request files paginate until a relevant file appears', async () => {
    const fullIrrelevantPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `docs/page-${index}.md`,
      status: 'modified',
    }));
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/pulls/341/files')) return undefined;
        return new URL(url).searchParams.get('page') === '1'
          ? json(fullIrrelevantPage)
          : json([{ filename: 'packages/shared/src/index.ts', status: 'modified' }]);
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({ kind: 'created', reason: 'created-ready' });
    expect(harness.requests.filter(({ url }) => url.includes('/pulls/341/files'))).toHaveLength(2);
  });

  test('a full final files page fails closed at the 30-page cap', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `docs/page-${index}.md`,
      status: 'modified',
    }));
    const harness = createHarness({
      respond: ({ url }) => (url.includes('/pulls/341/files') ? json(fullPage) : undefined),
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('files pagination');
    expect(harness.requests.filter(({ url }) => url.includes('/pulls/341/files'))).toHaveLength(30);
  });

  test('final label freshness prevents mutation after a concurrent state change', async () => {
    let pullRequestReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullRequestReads += 1;
        return json(
          pullRequestReads === 1
            ? pullRequest()
            : pullRequest({ labels: [{ name: 'no-preview' }] }),
        );
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'stale-event' }]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test.each([
    ['label', pullRequest({ labels: [{ name: 'no-preview' }] })],
    [
      'head',
      pullRequest({
        head: { sha: 'c'.repeat(40), ref: 'feature/preview-next', repo: repository },
      }),
    ],
  ])('a %s change during the final CI proof prevents Create', async (_name, changedPullRequest) => {
    let finalCiProofStarted = false;
    let workflowRunReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (url.endsWith('/pulls/341')) {
          return json(finalCiProofStarted ? changedPullRequest : pullRequest());
        }
        if (url.includes('/actions/workflows/456/runs')) {
          workflowRunReads += 1;
          if (workflowRunReads === 2) finalCiProofStarted = true;
          return json({ total_count: 1, workflow_runs: [workflowRun()] });
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'stale-event' }]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
    expect(workflowRunReads).toBe(2);
  });

  test('main advancing during project validation prevents Create', async () => {
    let projectValidated = false;
    const harness = createHarness({
      respond: ({ url }) => {
        if (url.includes('/v9/projects/')) {
          projectValidated = true;
          return json(vercelProject());
        }
        if (url.endsWith('/git/ref/heads/main')) {
          return json({ object: { sha: projectValidated ? NEW_SHA : MAIN_SHA } });
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      { kind: 'skipped', pullRequestNumber: 341, reason: 'ci-not-current' },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
  });

  test('pull request state changing during project validation prevents Create', async () => {
    let projectValidated = false;
    const harness = createHarness({
      respond: ({ url }) => {
        if (url.includes('/v9/projects/')) {
          projectValidated = true;
          return json(vercelProject());
        }
        if (url.endsWith('/pulls/341')) {
          return json(
            projectValidated ? pullRequest({ labels: [{ name: 'no-preview' }] }) : pullRequest(),
          );
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'stale-event' }]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
  });

  test('workflow_run with multiple distinct PR associations logs ambiguity and does no work', async () => {
    const event = workflowRunEvent({
      workflow_run: workflowRun({
        pull_requests: [
          ...workflowRun().pull_requests,
          {
            number: 342,
            head: { sha: SHA, ref: 'feature/other', repo: { id: 123, name: 'orbit' } },
            base: { sha: MAIN_SHA, ref: 'main', repo: { id: 123, name: 'orbit' } },
          },
        ],
      }),
    });
    const harness = createHarness({ event });

    await expect(reconcileVercelPreviews(harness.runtime)).resolves.toEqual([]);
    expect(harness.logs).toContain('workflow-run-ambiguous-associations');
    expect(harness.requests).toHaveLength(0);
  });
});

describe('bounded transport, polling, and ambiguity recovery', () => {
  test('a safe read uses at most three attempts before the later freshness read', async () => {
    let pullReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        return pullReads < 3 ? json({ message: 'temporary' }, 500) : json(pullRequest());
      },
    });

    await reconcileVercelPreviews(harness.runtime);

    expect(pullReads).toBe(5);
    expect(harness.sleeps.slice(0, 2)).toEqual([1000, 1000]);
  });

  test.each([401, 403])('ordinary %s read failures do not retry', async (status) => {
    let pullReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        return json({ message: 'denied' }, status);
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow(String(status));
    expect(pullReads).toBe(1);
  });

  test.each([
    ['network', 3, 2],
    ['body-read', 3, 2],
    ['invalid-json', 1, 0],
    ['invalid-schema', 1, 0],
  ] as const)(
    'safe-read %s failures have bounded attempts and no mutation',
    async (failure, expectedReads, expectedSleeps) => {
      let pullReads = 0;
      const harness = createHarness({
        respond: ({ url }) => {
          if (!url.endsWith('/pulls/341')) return undefined;
          pullReads += 1;
          if (failure === 'network') throw new Error(`${GITHUB_TOKEN} ${VERCEL_TOKEN}`);
          if (failure === 'body-read') {
            return unreadableJson(`${GITHUB_TOKEN} ${VERCEL_TOKEN}`);
          }
          if (failure === 'invalid-json') return new Response('{', { status: 200 });
          return json({ number: 341 });
        },
      });

      const message = await rejectionMessage(reconcileVercelPreviews(harness.runtime));

      expect(message).not.toBe('resolved');
      expect(message).not.toContain(GITHUB_TOKEN);
      expect(message).not.toContain(VERCEL_TOKEN);
      expect(pullReads).toBe(expectedReads);
      expect(harness.sleeps).toHaveLength(expectedSleeps);
      expect(harness.requests.some(({ method }) => method === 'POST' || method === 'PATCH')).toBe(
        false,
      );
    },
  );

  test('an injected request timeout aborts each safe-read attempt', async () => {
    let pendingTimeout: (() => void) | null = null;
    let pullReads = 0;
    let scheduledTimeouts = 0;
    const harness = createHarness({
      scheduleTimeout: (callback, milliseconds) => {
        expect(milliseconds).toBe(15_000);
        scheduledTimeouts += 1;
        pendingTimeout = callback;
        return () => {
          if (pendingTimeout === callback) pendingTimeout = null;
        };
      },
      respond: (request) => {
        if (!request.url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        return new Promise<Response>((resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('timed out', 'AbortError')),
            { once: true },
          );
          queueMicrotask(() => pendingTimeout?.());
          queueMicrotask(() => resolve(json({ message: 'timeout was not injected' }, 400)));
        });
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow();

    expect(pullReads).toBe(3);
    expect(scheduledTimeouts).toBe(3);
    expect(harness.requests.every(({ signal }) => signal?.aborted === true)).toBe(true);
    expect(harness.sleeps).toEqual([1000, 1000]);
  });

  test('rate-limited GitHub 403 retries with bounded Retry-After', async () => {
    let pullReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        return pullReads === 1
          ? json({ message: 'limited' }, 403, { 'Retry-After': '2' })
          : json(pullRequest());
      },
    });

    await reconcileVercelPreviews(harness.runtime);

    expect(pullReads).toBeGreaterThan(1);
    expect(harness.sleeps[0]).toBe(2000);
  });

  test('redirects are rejected without following token-bearing requests', async () => {
    const harness = createHarness({
      respond: ({ url }) =>
        url.endsWith('/pulls/341')
          ? new Response('', { status: 302, headers: { location: 'https://example.com' } })
          : undefined,
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('redirect rejected');
    expect(harness.requests).toHaveLength(1);
  });

  test('the polling owner cancels its created deployment when the exact head becomes ineligible', async () => {
    let createAttempted = false;
    const harness = createHarness({
      respond: ({ method, url }) => {
        if (url.endsWith('/pulls/341')) {
          return json(
            createAttempted ? pullRequest({ labels: [{ name: 'no-preview' }] }) : pullRequest(),
          );
        }
        if (method === 'POST') {
          createAttempted = true;
          return json(mutationDeployment('dpl_created', 'QUEUED'));
        }
        if (method === 'GET' && url.includes('/v13/deployments/dpl_created')) {
          return json(mutationDeployment('dpl_created', 'BUILDING'));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'canceled',
        pullRequestNumber: 341,
        reason: 'canceled-active',
        deploymentId: 'dpl_created',
        url: 'orbit-preview.vercel.app',
      },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
    expect(harness.sleeps.filter((milliseconds) => milliseconds === 5000)).toHaveLength(0);
  });

  test('project identity drift before a poll-triggered cancel blocks the PATCH', async () => {
    let createAttempted = false;
    let projectReads = 0;
    const harness = createHarness({
      respond: ({ method, url }) => {
        if (url.includes('/v9/projects/')) {
          projectReads += 1;
          return json(vercelProject(projectReads === 1 ? {} : { accountId: 'team_transferred' }));
        }
        if (url.endsWith('/pulls/341')) {
          return json(
            createAttempted ? pullRequest({ labels: [{ name: 'no-preview' }] }) : pullRequest(),
          );
        }
        if (method === 'POST') {
          createAttempted = true;
          return json(mutationDeployment('dpl_created', 'QUEUED'));
        }
        if (method === 'GET' && url.includes('/v13/deployments/dpl_created')) {
          return json(mutationDeployment('dpl_created', 'BUILDING'));
        }
        return undefined;
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('project identity');
    expect(projectReads).toBe(2);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
  });

  test('the polling owner cancels an existing active deployment when the exact head becomes draft', async () => {
    let pullRequestReads = 0;
    const harness = createHarness({
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ method, url }) => {
        if (url.endsWith('/pulls/341')) {
          pullRequestReads += 1;
          return json(pullRequest({ draft: pullRequestReads > 1 }));
        }
        if (method === 'GET' && url.includes('/v13/deployments/dpl_active')) {
          return json(mutationDeployment('dpl_active', 'BUILDING'));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'canceled',
        pullRequestNumber: 341,
        reason: 'canceled-active',
        deploymentId: 'dpl_active',
        url: 'orbit-preview.vercel.app',
      },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
    expect(harness.sleeps.filter((milliseconds) => milliseconds === 5000)).toHaveLength(0);
  });

  test('the polling owner cancels its active deployment after a same-ref head change', async () => {
    let createAttempted = false;
    const harness = createHarness({
      respond: ({ method, url }) => {
        if (url.endsWith('/pulls/341')) {
          return json(
            createAttempted
              ? pullRequest({
                  head: { sha: NEW_SHA, ref: 'feature/preview', repo: repository },
                })
              : pullRequest(),
          );
        }
        if (method === 'POST') {
          createAttempted = true;
          return json(mutationDeployment('dpl_created', 'QUEUED'));
        }
        if (method === 'GET' && url.includes('/v13/deployments/dpl_created')) {
          return json(mutationDeployment('dpl_created', 'BUILDING'));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([
      {
        kind: 'canceled',
        pullRequestNumber: 341,
        reason: 'canceled-active',
        deploymentId: 'dpl_created',
        url: 'orbit-preview.vercel.app',
      },
    ]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
    expect(harness.sleeps.filter((milliseconds) => milliseconds === 5000)).toHaveLength(0);
  });

  test('the polling owner does not cancel after the pull request head ref changes', async () => {
    let createAttempted = false;
    const harness = createHarness({
      respond: ({ method, url }) => {
        if (url.endsWith('/pulls/341')) {
          return json(
            createAttempted
              ? pullRequest({
                  head: { sha: NEW_SHA, ref: 'feature/new-head', repo: repository },
                })
              : pullRequest(),
          );
        }
        if (method === 'POST') {
          createAttempted = true;
          return json(mutationDeployment('dpl_created', 'QUEUED'));
        }
        if (method === 'GET' && url.includes('/v13/deployments/dpl_created')) {
          return json(mutationDeployment('dpl_created', 'BUILDING'));
        }
        return undefined;
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'stale-event' }]);
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
  });

  test('active polling sleeps through transitions and returns READY', async () => {
    const harness = createHarness({
      deployments: [deployment('QUEUED', { uid: 'dpl_active' })],
      detailStates: ['INITIALIZING', 'BUILDING', 'READY'],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({ reason: 'active-deployment-reused' });
    expect(harness.sleeps.filter((milliseconds) => milliseconds === 5000)).toHaveLength(2);
    expect(
      harness.requests.filter(({ url }) => url.includes('/v13/deployments/dpl_active')),
    ).toHaveLength(3);
  });

  test('active through the final polling GET stops after 240 sleeps and 241 GETs', async () => {
    let detailReads = 0;
    const harness = createHarness({
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ method, url }) => {
        if (method !== 'GET' || !url.includes('/v13/deployments/dpl_active')) return undefined;
        detailReads += 1;
        return json(mutationDeployment('dpl_active', detailReads === 242 ? 'READY' : 'BUILDING'));
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('timed out');
    expect(detailReads).toBe(241);
    expect(harness.sleeps.filter((milliseconds) => milliseconds === 5000)).toHaveLength(240);
  });

  test.each(['ERROR', 'CANCELED', 'BLOCKED', 'DELETED'])(
    'terminal polling state %s fails visibly',
    async (readyState) => {
      const harness = createHarness({
        deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
        detailStates: [readyState],
      });

      await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow(readyState);
      expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
    },
  );

  test.each(['network', '429', '500', '409', 'invalid-success'])(
    'ambiguous create outcome %s sends one POST and observes a newly visible ready deployment',
    async (outcome) => {
      let listReads = 0;
      const harness = createHarness({
        respond: ({ method, url }) => {
          if (url.includes('/v7/deployments')) {
            if (!new URL(url).searchParams.has('sha')) {
              return json({ deployments: [], pagination: { count: 0, next: null, prev: null } });
            }
            listReads += 1;
            const items = listReads === 1 ? [] : [deployment('READY', { uid: 'dpl_observed' })];
            return json({
              deployments: items,
              pagination: { count: items.length, next: null, prev: null },
            });
          }
          if (method === 'POST') {
            if (outcome === 'network') throw new Error(`${GITHUB_TOKEN} ${VERCEL_TOKEN}`);
            if (outcome === '429') return json({ message: VERCEL_TOKEN }, 429);
            if (outcome === '500') return json({ message: VERCEL_TOKEN }, 500);
            if (outcome === '409') return json({ message: GITHUB_TOKEN }, 409);
            return new Response('{', { status: 200 });
          }
          return undefined;
        },
      });

      const results = await reconcileVercelPreviews(harness.runtime);

      expect(results[0]).toMatchObject({ deploymentId: 'dpl_observed' });
      expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
      expect(listReads).toBe(2);
      expect(harness.requests.filter(({ url }) => url.includes('/v7/deployments'))).toHaveLength(3);
      expect(
        harness.requests.filter(({ url }) => url.includes('/v13/deployments/dpl_observed')),
      ).toHaveLength(0);
      expect(harness.sleeps).toHaveLength(0);
    },
  );

  test('an ambiguous Create timeout sends one POST and uses read-only observation', async () => {
    let pendingTimeout: (() => void) | null = null;
    let listReads = 0;
    const harness = createHarness({
      scheduleTimeout: (callback) => {
        pendingTimeout = callback;
        return () => {
          if (pendingTimeout === callback) pendingTimeout = null;
        };
      },
      respond: (request) => {
        if (request.url.includes('/v7/deployments')) {
          if (!new URL(request.url).searchParams.has('sha')) {
            return json({ deployments: [], pagination: { count: 0, next: null, prev: null } });
          }
          listReads += 1;
          const items = listReads === 1 ? [] : [deployment('READY', { uid: 'dpl_observed' })];
          return json({
            deployments: items,
            pagination: { count: items.length, next: null, prev: null },
          });
        }
        if (request.method !== 'POST') return undefined;
        return new Promise<Response>((resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('timed out', 'AbortError')),
            { once: true },
          );
          queueMicrotask(() => pendingTimeout?.());
          queueMicrotask(() => resolve(json({ message: 'timeout was not injected' }, 400)));
        });
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results[0]).toMatchObject({ deploymentId: 'dpl_observed' });
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(listReads).toBe(2);
    expect(harness.requests.filter(({ url }) => url.includes('/v7/deployments'))).toHaveLength(3);
    expect(
      harness.requests.filter(({ url }) => url.includes('/v13/deployments/dpl_observed')),
    ).toHaveLength(0);
    expect(harness.sleeps).toHaveLength(0);
  });

  test('ambiguous create ignores a pre-existing exact ID and fails without a second POST', async () => {
    const existing = deployment('ERROR', { uid: 'dpl_existing' });
    const harness = createHarness({
      deployments: [existing],
      respond: ({ method, url }) => {
        if (method === 'POST') return json({ message: 'temporary' }, 500);
        return url.includes('/v7/deployments')
          ? json({ deployments: [existing], pagination: { count: 1, next: null, prev: null } })
          : undefined;
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('ambiguous');
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
    expect(harness.requests.filter(({ url }) => url.includes('/v7/deployments'))).toHaveLength(5);
    expect(harness.requests.filter(({ url }) => url.includes('/v13/deployments/'))).toHaveLength(0);
    expect(harness.sleeps).toEqual([2000, 2000]);
  });

  test.each([400, 401, 403, 422])(
    'definitive create %s sends no retry or observation',
    async (status) => {
      let listReads = 0;
      const harness = createHarness({
        respond: ({ method, url }) => {
          if (url.includes('/v7/deployments')) listReads += 1;
          if (method === 'POST') return json({ message: 'definitive' }, status);
          return undefined;
        },
      });

      await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow(String(status));
      expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
      expect(listReads).toBe(2);
    },
  );

  test('controller deadline stops before the next request or sleep', async () => {
    let currentTime = 0;
    const harness = createHarness({
      now: () => currentTime,
      respond: ({ url }) => {
        if (url.endsWith('/pulls/341')) currentTime = 23 * 60 * 1000;
        return undefined;
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('controller-timeout');
    expect(harness.requests).toHaveLength(1);
    expect(harness.sleeps).toHaveLength(0);
  });

  test('errors and logs redact both tokens', async () => {
    const harness = createHarness({
      respond: ({ url }) => {
        if (url.endsWith('/pulls/341')) throw new Error(`${GITHUB_TOKEN} ${VERCEL_TOKEN}`);
        return undefined;
      },
    });

    let message = '';
    try {
      await reconcileVercelPreviews(harness.runtime);
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(GITHUB_TOKEN);
    expect(message).not.toContain(VERCEL_TOKEN);
    expect(JSON.stringify(harness.logs)).not.toContain(GITHUB_TOKEN);
    expect(JSON.stringify(harness.logs)).not.toContain(VERCEL_TOKEN);
  });
});

describe('identity invariants and bounded edge cases', () => {
  test.each([
    ['project ID', { id: 'prj_other' }, 'project identity'],
    ['project name', { name: 'other' }, 'project identity'],
    ['team ID', { accountId: 'team_other' }, 'project identity'],
    ['response schema', { accountId: undefined }, 'schema'],
  ])(
    'a mismatched Vercel %s blocks create before mutation',
    async (_name, projectOverrides, message) => {
      const harness = createHarness({
        respond: ({ url }) =>
          url.includes('/v9/projects/') ? json(vercelProject(projectOverrides)) : undefined,
      });

      await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow(message);
      expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
      expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
    },
  );

  test('a mismatched Vercel project blocks cancellation before mutation', async () => {
    const harness = createHarness({
      pullRequest: pullRequest({ draft: true }),
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ url }) =>
        url.includes('/v9/projects/')
          ? json(vercelProject({ accountId: 'team_other' }))
          : undefined,
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('project identity');
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(0);
  });

  test.each([
    ['wrong project', { projectId: 'prj_other' }],
    ['non-null target', { target: 'production' }],
    ['wrong metadata', { meta: metadata({ orbitGithubWorkflowRunId: 'wrong' }) }],
  ])('created response rejects %s', async (_name, responseOverrides) => {
    const harness = createHarness({
      respond: ({ method }) =>
        method === 'POST'
          ? json(mutationDeployment('dpl_created', 'QUEUED', responseOverrides))
          : undefined,
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('ambiguous create');
    expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  test.each([
    ['wrong project', 'dpl_active', { projectId: 'prj_other' }],
    ['non-null target', 'dpl_active', { target: 'production' }],
    ['wrong ID', 'dpl_other', {}],
    ['wrong metadata', 'dpl_active', { meta: metadata({ orbitDeploymentReason: 'wrong' }) }],
  ])('detail response rejects %s', async (_name, responseId, responseOverrides) => {
    const harness = createHarness({
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ method, url }) =>
        method === 'GET' && url.includes('/v13/deployments/dpl_active')
          ? json(mutationDeployment(responseId, 'READY', responseOverrides))
          : undefined,
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('identity drift');
  });

  test.each([
    ['wrong project', 'dpl_active', { projectId: 'prj_other' }],
    ['non-null target', 'dpl_active', { target: 'production' }],
    ['wrong ID', 'dpl_other', {}],
    ['wrong metadata', 'dpl_active', { meta: metadata({ orbitGithubWorkflowRunId: 'wrong' }) }],
  ])('cancel response rejects %s', async (_name, responseId, responseOverrides) => {
    const harness = createHarness({
      pullRequest: pullRequest({ draft: true }),
      deployments: [deployment('BUILDING', { uid: 'dpl_active' })],
      respond: ({ method }) =>
        method === 'PATCH'
          ? json(mutationDeployment(responseId, 'CANCELED', responseOverrides))
          : undefined,
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('identity drift');
    expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
  });

  test('a deployment URL containing either token is rejected before serialization', async () => {
    const harness = createHarness({
      deployments: [
        deployment('READY', { uid: 'dpl_ready', url: `${GITHUB_TOKEN}-${VERCEL_TOKEN}` }),
      ],
    });

    let message = '';
    try {
      await reconcileVercelPreviews(harness.runtime);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('unsafe');
    expect(message).not.toContain(GITHUB_TOKEN);
    expect(message).not.toContain(VERCEL_TOKEN);
  });

  test.each(['list', 'create', 'detail', 'cancel'] as const)(
    '%s deployment IDs containing either token are rejected before serialization',
    async (surface) => {
      for (const secret of [GITHUB_TOKEN, VERCEL_TOKEN]) {
        let deployments: readonly Record<string, unknown>[] = [];
        if (surface === 'list') deployments = [deployment('READY', { uid: secret })];
        if (surface === 'detail' || surface === 'cancel') {
          deployments = [deployment('BUILDING', { uid: 'dpl_active' })];
        }
        const harness = createHarness({
          pullRequest: pullRequest({ draft: surface === 'cancel' }),
          deployments,
          respond: ({ method, url }) => {
            if (surface === 'create' && method === 'POST') {
              return json(mutationDeployment(secret, 'QUEUED'));
            }
            if (
              surface === 'detail' &&
              method === 'GET' &&
              url.includes('/v13/deployments/dpl_active')
            ) {
              return json(mutationDeployment(secret, 'READY'));
            }
            if (surface === 'cancel' && method === 'PATCH') {
              return json(mutationDeployment(secret, 'CANCELED'));
            }
            return undefined;
          },
        });

        const message = await rejectionMessage(reconcileVercelPreviews(harness.runtime));

        expect(message).toContain('unsafe');
        expect(message).not.toContain(GITHUB_TOKEN);
        expect(message).not.toContain(VERCEL_TOKEN);
        expect(JSON.stringify(harness.logs)).not.toContain(secret);
        expect(harness.requests.filter(({ method }) => method === 'POST')).toHaveLength(
          surface === 'create' ? 1 : 0,
        );
        expect(harness.requests.filter(({ method }) => method === 'PATCH')).toHaveLength(
          surface === 'cancel' ? 1 : 0,
        );
      }
    },
  );

  test('Vercel pagination rejects a repeated zero cursor', async () => {
    const harness = createHarness({
      respond: ({ url }) =>
        url.includes('/v7/deployments')
          ? json({ deployments: [], pagination: { count: 0, next: 0, prev: null } })
          : undefined,
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('repeated');
    expect(harness.requests.filter(({ url }) => url.includes('/v7/deployments'))).toHaveLength(2);
  });

  test('Vercel pagination fails with a cursor remaining at its finite cap', async () => {
    let cursor = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/v7/deployments')) return undefined;
        cursor += 1;
        return json({ deployments: [], pagination: { count: 0, next: cursor, prev: null } });
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('incomplete');
    expect(harness.requests.filter(({ url }) => url.includes('/v7/deployments'))).toHaveLength(20);
  });

  test('equal workflow creation times choose the larger run ID', async () => {
    const harness = createHarness({
      workflowRuns: [
        workflowRun({ id: 10 }),
        workflowRun({ id: 11, status: 'completed', conclusion: 'failure' }),
      ],
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'ci-not-green' }]);
  });

  test('final CI proof blocks a run that turns non-green before create', async () => {
    let workflowReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.includes('/actions/workflows/456/runs')) return undefined;
        workflowReads += 1;
        const run =
          workflowReads === 1
            ? workflowRun()
            : workflowRun({ id: 987654322, status: 'completed', conclusion: 'failure' });
        return json({ total_count: 1, workflow_runs: [run] });
      },
    });

    const results = await reconcileVercelPreviews(harness.runtime);

    expect(results).toEqual([{ kind: 'skipped', pullRequestNumber: 341, reason: 'ci-not-green' }]);
    expect(harness.requests.some(({ method }) => method === 'POST')).toBe(false);
  });

  test('an HTTP-date Retry-After uses injected monotonic time', async () => {
    let pullReads = 0;
    const now = Date.parse('2026-08-21T00:00:00Z');
    const harness = createHarness({
      now: () => now,
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        return pullReads === 1
          ? json({ message: 'limited' }, 429, {
              'Retry-After': new Date(now + 3000).toUTCString(),
            })
          : json(pullRequest());
      },
    });

    await reconcileVercelPreviews(harness.runtime);

    expect(harness.sleeps[0]).toBe(3000);
  });

  test('an excessive Retry-After fails without sleeping or retrying', async () => {
    let pullReads = 0;
    const harness = createHarness({
      respond: ({ url }) => {
        if (!url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        return json({ message: 'limited' }, 429, { 'Retry-After': '31' });
      },
    });

    await expect(reconcileVercelPreviews(harness.runtime)).rejects.toThrow('excessive');
    expect(pullReads).toBe(1);
    expect(harness.sleeps).toHaveLength(0);
  });

  test('each retry attempt uses a fresh abort signal', async () => {
    const signals: AbortSignal[] = [];
    let pullReads = 0;
    const harness = createHarness({
      respond: (request) => {
        if (!request.url.endsWith('/pulls/341')) return undefined;
        pullReads += 1;
        expect(request.headers.get('authorization')).toBe(`Bearer ${GITHUB_TOKEN}`);
        return pullReads === 1 ? json({ message: 'temporary' }, 500) : json(pullRequest());
      },
    });
    const originalFetch = harness.runtime.fetch;
    const runtime: PreviewRuntime = {
      ...harness.runtime,
      fetch: async (input, init) => {
        if (String(input).endsWith('/pulls/341') && init?.signal) signals.push(init.signal);
        return await originalFetch(input, init);
      },
    };

    await reconcileVercelPreviews(runtime);

    expect(signals).toHaveLength(4);
    expect(new Set(signals).size).toBe(4);
  });

  test('missing configuration fails before reading the event', async () => {
    const harness = createHarness();
    const runtime: PreviewRuntime = {
      ...harness.runtime,
      env: { ...harness.runtime.env, VERCEL_PROJECT_ID: undefined },
    };

    await expect(reconcileVercelPreviews(runtime)).rejects.toThrow();
    expect(harness.requests).toHaveLength(0);
  });
});
