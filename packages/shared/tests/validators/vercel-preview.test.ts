import { describe, expect, test } from 'bun:test';
import {
  githubPreviewCommitPullsSchema,
  githubPreviewFilesSchema,
  githubPreviewPullRequestSchema,
  githubPreviewPullRequestTargetEventSchema,
  githubPreviewRefSchema,
  githubPreviewWorkflowDispatchEventSchema,
  githubPreviewWorkflowRunEventSchema,
  githubPreviewWorkflowRunsSchema,
  githubPreviewWorkflowSchema,
  vercelCreatedDeploymentSchema,
  vercelDeploymentSchema,
  vercelDeploymentsPageSchema,
  vercelPreviewEnvironmentSchema,
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
      head: { sha: SHA, ref: 'feature/preview', repo: repository },
      base: { sha: 'b'.repeat(40), ref: 'main', repo: repository },
    },
  ],
};

const environment = {
  GITHUB_EVENT_NAME: 'pull_request_target',
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
    expect(githubPreviewPullRequestSchema.parse(pullRequest).head.sha).toBe(SHA);
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
        action: 'ready_for_review',
        number: pullRequest.number,
        pull_request: pullRequest,
        repository,
      }),
    ).toMatchObject({ action: 'ready_for_review', number: pullRequest.number });
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

  test('accept a manual pull request input', () => {
    expect(
      githubPreviewWorkflowDispatchEventSchema.parse({
        inputs: { pull_request: '341' },
        repository,
      }).inputs.pull_request,
    ).toBe('341');
  });

  test('accept GitHub files, workflow runs, and commit pull pages', () => {
    expect(
      githubPreviewFilesSchema.parse([{ filename: 'apps/web/src/app/page.tsx' }]),
    ).toHaveLength(1);
    expect(
      githubPreviewWorkflowRunsSchema.parse({
        workflow_runs: [workflowRun],
      }).workflow_runs,
    ).toHaveLength(1);
    expect(githubPreviewCommitPullsSchema.parse([{ number: pullRequest.number }])).toHaveLength(1);
  });

  test('accept Vercel deployment pages and create responses', () => {
    expect(vercelDeploymentSchema.parse(deployment).readyState).toBe('BLOCKED');
    expect(
      vercelDeploymentsPageSchema.parse({
        deployments: [deployment],
        pagination: { next: 123, prev: null },
      }).pagination.next,
    ).toBe(123);
    expect(
      vercelCreatedDeploymentSchema.parse({
        id: 'dpl_preview',
        url: null,
        target: null,
        readyState: 'INITIALIZING',
        meta: deployment.meta,
      }).id,
    ).toBe('dpl_preview');
  });

  test('accept a complete controller environment', () => {
    expect(vercelPreviewEnvironmentSchema.parse(environment).VERCEL_PROJECT_ID).toBe('prj_orbit');
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

  test('reject an unknown Vercel ready state', () => {
    expect(() => vercelDeploymentSchema.parse({ ...deployment, readyState: 'UNKNOWN' })).toThrow();
  });

  test('reject a nonnumeric manual pull request input', () => {
    expect(() =>
      githubPreviewWorkflowDispatchEventSchema.parse({
        inputs: { pull_request: '341a' },
        repository,
      }),
    ).toThrow();
  });

  test('reject pagination without a finite cursor', () => {
    expect(() =>
      vercelDeploymentsPageSchema.parse({
        deployments: [],
        pagination: { next: Number.POSITIVE_INFINITY, prev: null },
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
