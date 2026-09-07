import { describe, expect, test } from 'bun:test';
import type {
  GithubPreviewFile,
  GithubPreviewPullRequest,
  VercelDeployment,
} from '../packages/shared/src/validators/index.ts';
import { vercelDeploymentSchema } from '../packages/shared/src/validators/index.ts';
import {
  isActiveVercelDeployment,
  isPreviewEligible,
  isReadyVercelDeployment,
  isSameRepositoryPullRequest,
  isWebPreviewFile,
  matchesVercelPullRequest,
} from './vercel-preview-policy.ts';

const SHA = 'a'.repeat(40);

const repository = {
  id: 123,
  name: 'orbit',
  owner: { login: 'Noveum' },
};

const readyPullRequest: GithubPreviewPullRequest = {
  number: 341,
  state: 'open',
  draft: false,
  labels: [],
  user: { login: 'maintainer' },
  head: { sha: SHA, ref: 'feature/preview', repo: repository },
  base: { ref: 'main', repo: repository },
};

const draftPullRequest: GithubPreviewPullRequest = { ...readyPullRequest, draft: true };
const forkPullRequest: GithubPreviewPullRequest = {
  ...readyPullRequest,
  head: {
    ...readyPullRequest.head,
    repo: { ...repository, id: 456, owner: { login: 'contributor' } },
  },
};

const deployment: VercelDeployment = {
  uid: 'dpl_preview',
  projectId: 'prj_orbit',
  url: null,
  target: null,
  readyState: 'READY',
  meta: {
    orbitGithubRepositoryId: '123',
    orbitGithubPrNumber: 341,
    orbitGithubHeadRef: 'feature/preview',
    orbitGithubHeadSha: SHA,
    orbitGithubWorkflowRunId: 987,
    orbitDeploymentReason: 'ci-green',
  },
};

function withLabels(
  pullRequest: GithubPreviewPullRequest,
  labels: readonly string[],
): GithubPreviewPullRequest {
  return { ...pullRequest, labels: labels.map((name) => ({ name })) };
}

describe('Preview eligibility', () => {
  test('uses the preview labels and draft state as the eligibility truth table', () => {
    expect(isPreviewEligible(readyPullRequest)).toBe(true);
    expect(isPreviewEligible(draftPullRequest)).toBe(false);
    expect(isPreviewEligible(withLabels(draftPullRequest, ['preview']))).toBe(true);
    expect(isPreviewEligible(withLabels(readyPullRequest, ['preview', 'no-preview']))).toBe(false);
  });

  test('requires a pull request head from the base repository', () => {
    expect(isSameRepositoryPullRequest(readyPullRequest)).toBe(true);
    expect(isSameRepositoryPullRequest(forkPullRequest)).toBe(false);
  });
});

describe('Web Preview path policy', () => {
  test('includes the application, packages, and deployment configuration', () => {
    for (const filename of [
      'apps/web/src/app/page.tsx',
      'packages/shared/src/index.ts',
      'package.json',
      'bun.lock',
      'tsconfig.base.json',
    ]) {
      expect(isWebPreviewFile({ filename, status: 'modified' })).toBe(true);
    }
  });

  test('excludes unrelated applications and documentation', () => {
    expect(isWebPreviewFile({ filename: 'apps/realtime/src/index.ts', status: 'modified' })).toBe(
      false,
    );
    expect(isWebPreviewFile({ filename: 'docs/README.md', status: 'modified' })).toBe(false);
  });

  test.each([
    [
      'into the web application',
      {
        filename: 'apps/web/src/feature.ts',
        status: 'renamed',
        previous_filename: 'docs/feature.ts',
      },
    ],
    [
      'out of the web application',
      {
        filename: 'docs/feature.ts',
        status: 'renamed',
        previous_filename: 'apps/web/src/feature.ts',
      },
    ],
    [
      'out of a shared package',
      {
        filename: 'docs/shared.ts',
        status: 'renamed',
        previous_filename: 'packages/shared/src/shared.ts',
      },
    ],
  ] satisfies readonly (readonly [string, GithubPreviewFile])[])(
    'treats a rename %s as web-impacting',
    (_name, file) => {
      expect(isWebPreviewFile(file)).toBe(true);
    },
  );

  test('ignores an unrelated rename', () => {
    expect(
      isWebPreviewFile({
        filename: 'docs/new-name.md',
        status: 'renamed',
        previous_filename: 'docs/old-name.md',
      }),
    ).toBe(false);
  });
});

describe('Vercel deployment policy', () => {
  test('matches Preview metadata after normalizing Vercel metadata values', () => {
    expect(matchesVercelPullRequest(deployment, readyPullRequest, 'prj_orbit', SHA)).toBe(true);
  });

  test('requires repository, pull request, ref, and supplied SHA to match', () => {
    expect(
      matchesVercelPullRequest(
        { ...deployment, meta: { ...deployment.meta, orbitGithubRepositoryId: '456' } },
        readyPullRequest,
        'prj_orbit',
        SHA,
      ),
    ).toBe(false);
    expect(
      matchesVercelPullRequest(
        { ...deployment, meta: { ...deployment.meta, orbitGithubPrNumber: '342' } },
        readyPullRequest,
        'prj_orbit',
        SHA,
      ),
    ).toBe(false);
    expect(
      matchesVercelPullRequest(
        { ...deployment, meta: { ...deployment.meta, orbitGithubHeadRef: 'other-ref' } },
        readyPullRequest,
        'prj_orbit',
        SHA,
      ),
    ).toBe(false);
    expect(
      matchesVercelPullRequest(deployment, readyPullRequest, 'prj_orbit', 'b'.repeat(40)),
    ).toBe(false);
  });

  test('requires the configured project Preview environment', () => {
    expect(matchesVercelPullRequest(deployment, readyPullRequest, 'prj_other', SHA)).toBe(false);
    expect(
      matchesVercelPullRequest(
        { ...deployment, target: 'staging' },
        readyPullRequest,
        'prj_orbit',
        SHA,
      ),
    ).toBe(false);
    expect(
      matchesVercelPullRequest(
        { ...deployment, target: 'production' },
        readyPullRequest,
        'prj_orbit',
        SHA,
      ),
    ).toBe(false);
    const { target: _target, ...withoutTarget } = deployment;
    expect(matchesVercelPullRequest(withoutTarget, readyPullRequest, 'prj_orbit', SHA)).toBe(false);
  });

  test('does not match an unrelated deployment without metadata', () => {
    const withoutMetadata = vercelDeploymentSchema.parse({
      uid: 'dpl_unrelated',
      projectId: 'prj_orbit',
      url: null,
      target: null,
      readyState: 'READY',
    });
    expect(matchesVercelPullRequest(withoutMetadata, readyPullRequest, 'prj_orbit', SHA)).toBe(
      false,
    );
  });

  test('recognizes only queued, initializing, and building deployments as active', () => {
    for (const readyState of ['QUEUED', 'INITIALIZING', 'BUILDING'] as const) {
      expect(isActiveVercelDeployment({ ...deployment, readyState })).toBe(true);
    }
    expect(isActiveVercelDeployment(deployment)).toBe(false);
  });

  test('recognizes only READY deployments as ready', () => {
    expect(isReadyVercelDeployment(deployment)).toBe(true);
    expect(isReadyVercelDeployment({ ...deployment, readyState: 'BLOCKED' })).toBe(false);
  });
});
