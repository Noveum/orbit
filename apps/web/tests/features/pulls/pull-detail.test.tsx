import { describe, expect, it } from 'bun:test';
import type { PullRequestDetail } from '@/features/pulls/data.ts';
import { PullDetail } from '@/features/pulls/pull-detail.tsx';
import { render, screen } from '@/test/render.tsx';

const pull: PullRequestDetail = {
  id: 'pull_1',
  title: 'Mirror the complete review timeline',
  body: 'Keeps reviews visible in Orbit.',
  url: 'https://github.com/noveum/orbit/pull/304',
  repository: 'noveum/orbit',
  number: 304,
  branch: 'codex/github-inbox',
  baseRef: 'main',
  state: 'approved',
  draft: false,
  merged: false,
  authorLogin: 'octocat',
  reviewDecision: 'approved',
  checkStatus: 'success',
  activityCount: 2,
  linkedIssues: [
    {
      identifier: 'ENG-42',
      title: 'Complete GitHub reviews',
      project: { id: 'project_1', name: 'Developer experience', slug: 'developer-experience' },
    },
  ],
  updatedAt: '2026-08-13T05:00:00.000Z',
  activities: [
    {
      id: 'activity_2',
      type: 'review_comment',
      action: 'created',
      actorLogin: 'grace',
      body: 'Please keep the stable repository ID.',
      url: 'https://github.com/noveum/orbit/pull/304#discussion_r2',
      state: 'created',
      path: 'packages/services/src/github/apply.ts',
      line: 42,
      occurredAt: '2026-08-13T05:00:00.000Z',
    },
    {
      id: 'activity_1',
      type: 'review',
      action: 'submitted',
      actorLogin: 'ada',
      body: 'Approved.',
      url: 'https://github.com/noveum/orbit/pull/304#pullrequestreview-1',
      state: 'approved',
      path: null,
      line: null,
      occurredAt: '2026-08-13T04:00:00.000Z',
    },
  ],
};

describe('PullDetail', () => {
  it('keeps review comments, their code location, and GitHub destination visible', () => {
    render(<PullDetail pull={pull} />);

    expect(screen.getByText('Please keep the stable repository ID.')).toBeInTheDocument();
    expect(screen.getByText('packages/services/src/github/apply.ts:42')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View on GitHub' })[0]).toHaveAttribute(
      'href',
      'https://github.com/noveum/orbit/pull/304#discussion_r2',
    );
  });

  it('shows linked task and project context without replacing the pull request', () => {
    render(<PullDetail pull={pull} />);

    expect(screen.getByTestId('pull-detail-issue-ENG-42')).toHaveAttribute('href', '/issue/ENG-42');
    expect(screen.getByRole('link', { name: 'Developer experience' })).toHaveAttribute(
      'href',
      '/projects/developer-experience',
    );
    expect(screen.getByRole('link', { name: /Open on GitHub/ })).toHaveAttribute(
      'href',
      'https://github.com/noveum/orbit/pull/304',
    );
  });
});
