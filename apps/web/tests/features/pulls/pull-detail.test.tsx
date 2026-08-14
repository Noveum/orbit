import { describe, expect, it } from 'bun:test';
import type { PullRequestDetail } from '@/features/pulls/data.ts';
import { PullDetail } from '@/features/pulls/pull-detail.tsx';
import { render, screen } from '@/test/render.tsx';

const pull: PullRequestDetail = {
  id: 'pull_1',
  title: 'Mirror the complete review timeline',
  body: 'Keeps **reviews** visible in [Orbit](https://orbit.noveum.ai).',
  bodyHtml:
    '<p>Keeps <strong>reviews</strong> visible in <a href="https://orbit.noveum.ai" target="_blank" rel="noopener noreferrer">Orbit</a>.</p>',
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
      body: 'Please keep the `repositoryId` stable.',
      bodyHtml: 'Please keep the <code>repositoryId</code> stable.',
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
      bodyHtml: '<p><strong>Approved.</strong></p>',
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

    expect(screen.getByText('repositoryId')).toHaveRole('code');
    expect(screen.getByText('packages/services/src/github/apply.ts:42')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View on GitHub' })[0]).toHaveAttribute(
      'href',
      'https://github.com/noveum/orbit/pull/304#discussion_r2',
    );
  });

  it('renders the sanitized GitHub Markdown produced by the data layer', () => {
    render(<PullDetail pull={pull} />);

    expect(screen.getByText('reviews')).toHaveRole('strong');
    expect(screen.getByRole('link', { name: 'Orbit' })).toHaveAttribute(
      'href',
      'https://orbit.noveum.ai',
    );
    expect(screen.getByText('Approved.')).toHaveRole('strong');
  });

  it('uses the white application surface and labels its activity status', () => {
    render(<PullDetail pull={pull} />);

    expect(screen.getByTestId('pull-detail')).toHaveClass('bg-surface');
    expect(screen.getByLabelText('Review approved')).toBeInTheDocument();
  });

  it('makes a capped production timeline explicit', () => {
    render(<PullDetail pull={{ ...pull, activityCount: 812 }} />);

    expect(screen.getByText('Showing latest 2 of 812 events')).toBeInTheDocument();
  });

  it('uses singular wording for one activity event', () => {
    const firstActivity = pull.activities[0];
    if (firstActivity === undefined) throw new Error('the activity fixture is missing');
    render(<PullDetail pull={{ ...pull, activityCount: 1, activities: [firstActivity] }} />);

    expect(screen.getByText('1 event')).toBeInTheDocument();
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
