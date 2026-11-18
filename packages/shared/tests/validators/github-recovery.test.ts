import { describe, expect, it } from 'bun:test';
import {
  githubRecoveryInstallationSchema,
  githubRecoveryPullRequestSchema,
  githubRecoveryRepositoriesSchema,
  githubRecoveryRequestSchema,
} from '../../src/validators/github-recovery.ts';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const selector = {
  reconciliationId: 'job-fixture',
  pullRequestId: 'pull-fixture',
  expectedJobVersion: 3,
  expectedContextGeneration: 2,
  expectedHeadEpoch: 4,
  expectedHeadSha: HEAD,
};
const installation = {
  id: 9001,
  app_id: 123456,
  account: { id: 500, login: 'fixture-owner' },
  suspended_at: null,
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

describe('GitHub recovery request boundary', () => {
  it('accepts one exact opaque target and its immutable expected generations', () => {
    expect(githubRecoveryRequestSchema.safeParse(selector).success).toBe(true);
  });
  it('refuses caller-selected workspace, installation and provider targets', () => {
    for (const extra of [
      { organizationId: 'other-org' },
      { installationId: '9002' },
      { repositoryId: '100' },
      { apiBase: 'https://other.example' },
    ]) {
      expect(githubRecoveryRequestSchema.safeParse({ ...selector, ...extra }).success).toBe(false);
    }
  });
  it('refuses invalid selectors instead of broadening to an unspecified target', () => {
    for (const change of [
      { reconciliationId: '' },
      { expectedJobVersion: 0 },
      { expectedContextGeneration: -1 },
      { expectedHeadEpoch: -1 },
      { expectedHeadSha: 'short' },
    ]) {
      expect(githubRecoveryRequestSchema.safeParse({ ...selector, ...change }).success).toBe(false);
    }
  });
});

describe('GitHub recovery live provider boundary', () => {
  it('requires actual App, installation, account and suspension facts', () => {
    expect(githubRecoveryInstallationSchema.safeParse(installation).success).toBe(true);
    expect(
      githubRecoveryInstallationSchema.safeParse({ ...installation, app_id: undefined }).success,
    ).toBe(false);
    expect(
      githubRecoveryInstallationSchema.safeParse({ ...installation, suspended_at: undefined })
        .success,
    ).toBe(false);
  });
  it('accepts exactly one scoped repository and a canonical current name', () => {
    expect(
      githubRecoveryRepositoriesSchema.safeParse({
        total_count: 1,
        repositories: [{ id: 99, full_name: 'fixture-owner/renamed-repo' }],
      }).success,
    ).toBe(true);
    expect(
      githubRecoveryRepositoriesSchema.safeParse({
        total_count: 2,
        repositories: [
          { id: 99, full_name: 'fixture-owner/repo' },
          { id: 100, full_name: 'other/repo' },
        ],
      }).success,
    ).toBe(false);
    expect(
      githubRecoveryRepositoriesSchema.safeParse({
        total_count: 1,
        repositories: [{ id: 99, full_name: 'fixture-owner/..' }],
      }).success,
    ).toBe(false);
  });
  it('retains open draft state, merged state and base repository identity', () => {
    expect(githubRecoveryPullRequestSchema.safeParse(pull).success).toBe(true);
    expect(
      githubRecoveryPullRequestSchema.safeParse({ ...pull, state: 'closed', merged: true }).success,
    ).toBe(true);
    expect(githubRecoveryPullRequestSchema.safeParse({ ...pull, base: undefined }).success).toBe(
      false,
    );
    expect(
      githubRecoveryPullRequestSchema.safeParse({ ...pull, state: 'open', merged: true }).success,
    ).toBe(false);
  });
});
