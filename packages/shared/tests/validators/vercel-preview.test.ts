import { describe, expect, test } from 'bun:test';
import {
  githubPreviewFilesSchema,
  githubPreviewPullRequestSchema,
  githubPreviewPullRequestTargetEventSchema,
  githubPreviewRefSchema,
  githubPreviewRepositoryDispatchEventSchema,
  githubPreviewWorkflowRunEventSchema,
  githubPreviewWorkflowRunsSchema,
  githubPreviewWorkflowSchema,
  vercelCanceledDeploymentSchema,
  vercelCreatedDeploymentSchema,
  vercelDeploymentDetailSchema,
  vercelDeploymentSchema,
  vercelDeploymentsPageSchema,
  vercelPreviewEnvironmentSchema,
  vercelProjectSchema,
} from '../../src/validators/vercel-preview.ts';

const SHA = 'a'.repeat(40);

const repository = {
  id: 123,
  name: 'orbit',
  owner: { login: 'Noveum' },
};

const pullRequest = {
  number: 341,
  state: 'open' as const,
  draft: false,
  labels: [{ name: 'preview' }],
  user: { login: 'maintainer' },
  head: {
    sha: SHA,
    ref: 'feature/preview',
    repo: repository,
  },
  base: {
    ref: 'main',
    repo: repository,
  },
};

const deployment = {
  uid: 'dpl_preview',
  projectId: 'prj_orbit',
  url: null,
  target: null,
  readyState: 'BLOCKED' as const,
  meta: {
    orbitGithubHeadRef: 'feature/preview',
    orbitGithubHeadSha: SHA,
    orbitGithubPrNumber: '341',
    orbitGithubRepositoryId: 123,
    orbitGithubWorkflowRunId: 987,
    orbitDeploymentReason: 'ci-green',
    retried: false,
    note: null,
  },
};

const mutationDeployment = {
  id: 'dpl_preview',
  projectId: 'prj_orbit',
  url: 'orbit-preview.vercel.app',
  target: null,
  readyState: 'INITIALIZING' as const,
  meta: deployment.meta,
};

const workflowRun = {
  id: 987,
  workflow_id: 456,
  name: 'CI',
  event: 'pull_request',
  head_sha: SHA,
  status: 'completed' as const,
  conclusion: 'success',
  created_at: '2026-08-21T00:00:00Z',
  pull_requests: [
    {
      number: pullRequest.number,
      head: {
        sha: SHA,
        ref: 'feature/preview',
        repo: { id: 123, name: 'orbit', url: 'https://api.github.com/repos/Noveum/orbit' },
      },
      base: {
        sha: 'b'.repeat(40),
        ref: 'main',
        repo: { id: 123, name: 'orbit', url: 'https://api.github.com/repos/Noveum/orbit' },
      },
    },
  ],
};

const environment = {
  GITHUB_EVENT_NAME: 'repository_dispatch',
  GITHUB_EVENT_PATH: '/tmp/event.json',
  GITHUB_REPOSITORY: 'Noveum/orbit',
  GITHUB_TOKEN: 'github-token',
  VERCEL_TOKEN: 'vercel-token',
  VERCEL_TEAM_ID: 'team_orbit',
  VERCEL_PROJECT_ID: 'prj_orbit',
  VERCEL_PROJECT_NAME: 'orbit',
};

describe('Vercel Preview GitHub schemas', () => {
  test('accept a complete open pull request', () => {
    const parsed = githubPreviewPullRequestSchema.parse(pullRequest);

    expect(parsed.head.sha).toBe(SHA);
    expect(parsed.user.login).toBe('maintainer');
  });

  test('accept a Git reference with an immutable object SHA', () => {
    expect(githubPreviewRefSchema.parse({ object: { sha: SHA } }).object.sha).toBe(SHA);
  });

  test('accept the canonical CI workflow identity', () => {
    expect(
      githubPreviewWorkflowSchema.parse({
        id: 456,
        name: 'CI',
        path: '.github/workflows/ci.yml',
        state: 'active',
      }).path,
    ).toBe('.github/workflows/ci.yml');
  });

  test('accept a pull request state event', () => {
    expect(
      githubPreviewPullRequestTargetEventSchema.parse({
        action: 'closed',
        number: pullRequest.number,
        pull_request: pullRequest,
        repository,
      }),
    ).toMatchObject({ action: 'closed', number: pullRequest.number });
  });

  test('accept a pull request synchronize event', () => {
    expect(
      githubPreviewPullRequestTargetEventSchema.parse({
        action: 'synchronize',
        number: pullRequest.number,
        pull_request: pullRequest,
        repository,
      }),
    ).toMatchObject({ action: 'synchronize', number: pullRequest.number });
  });

  test('accept a successful CI workflow event', () => {
    expect(
      githubPreviewWorkflowRunEventSchema.parse({
        action: 'completed',
        repository,
        workflow_run: workflowRun,
      }),
    ).toMatchObject({ workflow_run: { head_sha: SHA } });
  });

  test('accept a repository dispatch pull request input', () => {
    expect(
      githubPreviewRepositoryDispatchEventSchema.parse({
        action: 'vercel-preview-reconcile',
        client_payload: { pull_request: 341 },
        repository,
      }).client_payload.pull_request,
    ).toBe(341);
  });

  test('accept GitHub files and workflow runs with minimal linked repositories', () => {
    expect(
      githubPreviewFilesSchema.parse([
        { filename: 'apps/web/src/app/page.tsx', status: 'modified' },
      ]),
    ).toHaveLength(1);
    expect(
      githubPreviewWorkflowRunsSchema.parse({
        total_count: 1,
        workflow_runs: [workflowRun],
      }).workflow_runs,
    ).toHaveLength(1);
  });

  test('retains validated rename history from GitHub file responses', () => {
    const files = githubPreviewFilesSchema.parse([
      {
        filename: 'docs/feature.ts',
        status: 'renamed',
        previous_filename: 'apps/web/src/feature.ts',
      },
      { filename: 'packages/shared/src/index.ts', status: 'modified' },
    ]);

    expect(files).toEqual([
      {
        filename: 'docs/feature.ts',
        status: 'renamed',
        previous_filename: 'apps/web/src/feature.ts',
      },
      { filename: 'packages/shared/src/index.ts', status: 'modified' },
    ]);
  });

  test.each([
    ['missing previous filename', { filename: 'docs/feature.ts', status: 'renamed' }],
    [
      'empty previous filename',
      { filename: 'docs/feature.ts', status: 'renamed', previous_filename: '' },
    ],
    [
      'oversized previous filename',
      { filename: 'docs/feature.ts', status: 'renamed', previous_filename: 'a'.repeat(1025) },
    ],
    [
      'nonnumeric status',
      { filename: 'docs/feature.ts', status: 1, previous_filename: 'apps/web/src/feature.ts' },
    ],
  ])('reject a renamed file with %s', (_name, file) => {
    expect(() => githubPreviewFilesSchema.parse([file])).toThrow();
  });

  test('requires a workflow run total count', () => {
    expect(() => githubPreviewWorkflowRunsSchema.parse({ workflow_runs: [workflowRun] })).toThrow();
  });

  test('accept Vercel deployment pages and mutation responses', () => {
    expect(vercelDeploymentSchema.parse(deployment).readyState).toBe('BLOCKED');
    const page = vercelDeploymentsPageSchema.parse({
      deployments: [
        deployment,
        {
          uid: 'dpl_unrelated',
          projectId: 'prj_orbit',
          url: null,
          target: null,
          readyState: 'READY',
        },
      ],
      pagination: { count: 2, next: 123, prev: null },
    });
    expect(page.pagination.next).toBe(123);
    expect(page.deployments[1]?.meta).toEqual({});
    expect(vercelCreatedDeploymentSchema.parse(mutationDeployment).id).toBe('dpl_preview');
    expect(vercelDeploymentDetailSchema.parse(mutationDeployment).url).toBe(
      'orbit-preview.vercel.app',
    );
    expect(
      vercelCanceledDeploymentSchema.parse({ ...mutationDeployment, readyState: 'CANCELED' }).id,
    ).toBe('dpl_preview');
  });

  test('validate the Vercel project identity boundary', () => {
    expect(
      vercelProjectSchema.parse({ id: 'prj_orbit', name: 'orbit', accountId: 'team_orbit' }),
    ).toMatchObject({ id: 'prj_orbit', name: 'orbit', accountId: 'team_orbit' });
    expect(() => vercelProjectSchema.parse({ id: 'prj_orbit', name: 'orbit' })).toThrow();
  });

  test('accept a complete controller environment', () => {
    expect(vercelPreviewEnvironmentSchema.parse(environment).VERCEL_PROJECT_ID).toBe('prj_orbit');
  });

  test('reject a manual workflow dispatch environment', () => {
    expect(() =>
      vercelPreviewEnvironmentSchema.parse({
        ...environment,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
      }),
    ).toThrow();
  });

  test('reject a short pull request head SHA', () => {
    expect(() =>
      githubPreviewPullRequestSchema.parse({
        ...pullRequest,
        head: { ...pullRequest.head, sha: 'short' },
      }),
    ).toThrow();
  });

  test('reject a pull request without a repository ID', () => {
    expect(() =>
      githubPreviewPullRequestSchema.parse({
        ...pullRequest,
        head: { ...pullRequest.head, repo: { ...repository, id: undefined } },
      }),
    ).toThrow();
  });

  test('reject a pull request without draft state', () => {
    const { draft: _draft, ...withoutDraft } = pullRequest;
    expect(() => githubPreviewPullRequestSchema.parse(withoutDraft)).toThrow();
  });

  test('reject a pull request without an author identity', () => {
    const { user: _user, ...withoutUser } = pullRequest;

    expect(githubPreviewPullRequestSchema.safeParse(withoutUser).success).toBe(false);
  });

  test('reject an unknown Vercel ready state', () => {
    expect(() => vercelDeploymentSchema.parse({ ...deployment, readyState: 'UNKNOWN' })).toThrow();
  });

  test('reject mutation responses without complete deployment identity', () => {
    expect(() => vercelCreatedDeploymentSchema.parse({ ...mutationDeployment, id: '' })).toThrow();
    expect(() => {
      const { projectId: _projectId, ...withoutProjectId } = mutationDeployment;
      return vercelDeploymentDetailSchema.parse(withoutProjectId);
    }).toThrow();
    expect(() =>
      vercelCanceledDeploymentSchema.parse({ ...mutationDeployment, url: null }),
    ).toThrow();
    expect(() => {
      const { meta: _meta, ...withoutMetadata } = mutationDeployment;
      return vercelCreatedDeploymentSchema.parse(withoutMetadata);
    }).toThrow();
    expect(() => {
      const { target: _target, ...withoutTarget } = mutationDeployment;
      return vercelDeploymentDetailSchema.parse(withoutTarget);
    }).toThrow();
  });

  test.each([
    ['list', vercelDeploymentSchema, { ...deployment, uid: '../dpl?unsafe#fragment' }],
    [
      'create',
      vercelCreatedDeploymentSchema,
      { ...mutationDeployment, id: '../dpl?unsafe#fragment' },
    ],
    [
      'detail',
      vercelDeploymentDetailSchema,
      { ...mutationDeployment, id: '../dpl?unsafe#fragment' },
    ],
    [
      'cancel',
      vercelCanceledDeploymentSchema,
      { ...mutationDeployment, id: '../dpl?unsafe#fragment' },
    ],
  ])('reject a %s response with a path-delimited deployment ID', (_name, schema, value) => {
    expect(() => schema.parse(value)).toThrow();
  });

  test.each([' dpl_preview', 'dpl_preview '])(
    'reject a deployment ID with unsupported whitespace %j',
    (id) => {
      expect(() => vercelDeploymentSchema.parse({ ...deployment, uid: id })).toThrow();
      expect(() => vercelCreatedDeploymentSchema.parse({ ...mutationDeployment, id })).toThrow();
    },
  );

  test.each(['dpl_7Gw5ZMBpQA8h9GF832KGp7nwbuh3', 'custom-deployment_123'])(
    'accept supported Vercel deployment ID %s',
    (id) => {
      expect(vercelDeploymentSchema.parse({ ...deployment, uid: id }).uid).toBe(id);
      expect(vercelCreatedDeploymentSchema.parse({ ...mutationDeployment, id }).id).toBe(id);
    },
  );

  test('reject malformed repository dispatch pull request inputs', () => {
    const event = {
      action: 'vercel-preview-reconcile',
      repository,
      client_payload: { pull_request: 341 },
    };

    expect(() =>
      githubPreviewRepositoryDispatchEventSchema.parse({
        action: event.action,
        repository: event.repository,
        client_payload: {},
      }),
    ).toThrow();
    expect(() =>
      githubPreviewRepositoryDispatchEventSchema.parse({
        ...event,
        client_payload: { pull_request: '341' },
      }),
    ).toThrow();
    expect(() =>
      githubPreviewRepositoryDispatchEventSchema.parse({
        ...event,
        client_payload: { pull_request: 341.5 },
      }),
    ).toThrow();
    expect(() =>
      githubPreviewRepositoryDispatchEventSchema.parse({
        ...event,
        client_payload: { pull_request: 0 },
      }),
    ).toThrow();
    expect(() =>
      githubPreviewRepositoryDispatchEventSchema.parse({
        ...event,
        client_payload: { pull_request: -1 },
      }),
    ).toThrow();
    expect(() =>
      githubPreviewRepositoryDispatchEventSchema.parse({
        ...event,
        client_payload: { pull_request: 2_147_483_648 },
      }),
    ).toThrow();
  });

  test('reject pagination without a finite cursor', () => {
    expect(() =>
      vercelDeploymentsPageSchema.parse({
        deployments: [],
        pagination: { next: null, prev: null },
      }),
    ).toThrow();
    expect(() =>
      vercelDeploymentsPageSchema.parse({
        deployments: [],
        pagination: { count: 0, next: Number.POSITIVE_INFINITY, prev: null },
      }),
    ).toThrow();
  });

  test('reject an environment with missing secrets', () => {
    expect(() =>
      vercelPreviewEnvironmentSchema.parse({
        GITHUB_EVENT_NAME: 'pull_request_target',
        GITHUB_EVENT_PATH: '/tmp/event.json',
      }),
    ).toThrow();
  });
});
