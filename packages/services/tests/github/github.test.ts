import { describe, expect, it } from 'bun:test';
import {
  canAdvance,
  notificationTypeForReview,
  notificationTypeForState,
  parseGithubEvent,
  pullRequestState,
  targetCategoryFor,
  verifyGithubSignature,
} from '../../src/github/index.ts';

const SECRET = "It's a Secret to Everybody";
const BODY = '{"zen":"Keep it logically awesome."}';
const SIGNATURE = 'sha256=b9f180c4171a9926a5055962b54ec47b0ebee85e62e76c83ebdbb382f77b05ac';

describe('verifyGithubSignature', () => {
  it('accepts the documented github vector', () => {
    expect(verifyGithubSignature(BODY, SIGNATURE, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyGithubSignature(`${BODY} `, SIGNATURE, SECRET)).toBe(false);
  });

  it('rejects a tampered signature of the same length', () => {
    const flipped = `${SIGNATURE.slice(0, -1)}${SIGNATURE.endsWith('c') ? 'd' : 'c'}`;
    expect(verifyGithubSignature(BODY, flipped, SECRET)).toBe(false);
  });

  it('rejects a wrong secret, an empty secret and a missing header', () => {
    expect(verifyGithubSignature(BODY, SIGNATURE, 'nope')).toBe(false);
    expect(verifyGithubSignature(BODY, SIGNATURE, '')).toBe(false);
    expect(verifyGithubSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, 'sha256=short', SECRET)).toBe(false);
  });
});

describe('pullRequestState', () => {
  it('resolves lifecycle and review decisions with the right precedence', () => {
    expect(pullRequestState({ draft: true, merged: false, closed: false })).toBe('draft');
    expect(pullRequestState({ draft: false, merged: false, closed: false })).toBe('open');
    expect(pullRequestState({ draft: false, merged: true, closed: true })).toBe('merged');
    expect(pullRequestState({ draft: false, merged: false, closed: true })).toBe('closed');
    expect(pullRequestState({ draft: true, merged: true, closed: true })).toBe('merged');
    expect(
      pullRequestState({ draft: false, merged: false, closed: false, review: 'approved' }),
    ).toBe('approved');
    expect(
      pullRequestState({ draft: false, merged: false, closed: false, review: 'changes_requested' }),
    ).toBe('changes_requested');
  });
});

describe('targetCategoryFor', () => {
  it('maps the six pull request states to workflow categories', () => {
    expect(targetCategoryFor('draft')).toBe('started');
    expect(targetCategoryFor('open')).toBe('review');
    expect(targetCategoryFor('approved')).toBe('review');
    expect(targetCategoryFor('changes_requested')).toBe('started');
    expect(targetCategoryFor('merged')).toBe('completed');
    expect(targetCategoryFor('closed')).toBe('canceled');
  });
});

describe('canAdvance', () => {
  it('advances forward only', () => {
    expect(canAdvance('backlog', 'started')).toBe(true);
    expect(canAdvance('unstarted', 'review')).toBe(true);
    expect(canAdvance('started', 'completed')).toBe(true);
  });

  it('never moves an issue backwards', () => {
    expect(canAdvance('review', 'started')).toBe(false);
    expect(canAdvance('completed', 'review')).toBe(false);
    expect(canAdvance('completed', 'completed')).toBe(false);
  });

  it('never resurrects a terminal issue', () => {
    expect(canAdvance('completed', 'canceled')).toBe(false);
    expect(canAdvance('canceled', 'completed')).toBe(false);
  });
});

describe('notification type helpers', () => {
  it('maps review decisions', () => {
    expect(notificationTypeForReview('approved')).toBe('pr_approved');
    expect(notificationTypeForReview('changes_requested')).toBe('pr_review_submitted');
    expect(notificationTypeForReview('commented')).toBe('pr_review_submitted');
  });

  it('maps terminal lifecycle states', () => {
    expect(notificationTypeForState('merged')).toBe('pr_merged');
    expect(notificationTypeForState('closed')).toBe('pr_closed');
    expect(notificationTypeForState('open')).toBeNull();
    expect(notificationTypeForState('approved')).toBeNull();
  });
});

describe('parseGithubEvent', () => {
  it('normalizes a pull request event', () => {
    const event = parseGithubEvent('pull_request', {
      action: 'opened',
      pull_request: {
        number: 12,
        title: 'Fix ENG-3 dashboard',
        html_url: 'https://github.com/acme/web/pull/12',
        draft: true,
        merged: false,
        state: 'open',
        head: { ref: 'eng-3-dashboard' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 1 },
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'octocat', id: 1 },
    });
    expect(event?.pullRequest?.number).toBe(12);
    expect(event?.pullRequest?.headRef).toBe('eng-3-dashboard');
    expect(event?.repository.externalId).toBe('99');
  });

  it('normalizes a review event', () => {
    const event = parseGithubEvent('pull_request_review', {
      action: 'submitted',
      review: { state: 'approved', html_url: 'https://x/r', user: { login: 'a', id: 2 } },
      pull_request: {
        number: 3,
        title: 't',
        html_url: 'https://x',
        head: { ref: 'eng-5' },
        base: { ref: 'main' },
      },
      repository: { id: 1, full_name: 'a/b' },
      sender: { login: 'a', id: 2 },
    });
    expect(event?.review?.decision).toBe('approved');
  });

  it('normalizes a conversation comment only when it belongs to a pull request', () => {
    const event = parseGithubEvent('issue_comment', {
      action: 'created',
      issue: {
        number: 7,
        title: 'Rework dashboard',
        html_url: 'https://github.com/acme/web/pull/7',
        pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/7' },
      },
      comment: {
        body: 'Please add a regression test.',
        html_url: 'https://github.com/acme/web/pull/7#issuecomment-1',
        user: { login: 'reviewer', id: 2 },
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'reviewer', id: 2 },
    });

    expect(event?.comment).toEqual({
      body: 'Please add a regression test.',
      url: 'https://github.com/acme/web/pull/7#issuecomment-1',
      kind: 'conversation',
    });
    expect(event?.pullRequest?.number).toBe(7);

    expect(
      parseGithubEvent('issue_comment', {
        action: 'created',
        issue: {
          number: 7,
          title: 'Ordinary issue',
          html_url: 'https://github.com/acme/web/issues/7',
        },
        comment: {
          body: 'Not a pull request.',
          html_url: 'https://github.com/acme/web/issues/7#issuecomment-1',
        },
        repository: { id: 99, full_name: 'acme/web' },
        sender: { login: 'reviewer', id: 2 },
      }),
    ).toBeNull();
  });

  it('normalizes an inline review comment', () => {
    const event = parseGithubEvent('pull_request_review_comment', {
      action: 'created',
      pull_request: {
        number: 7,
        title: 'Rework dashboard',
        html_url: 'https://github.com/acme/web/pull/7',
        head: { ref: 'eng-3-dashboard' },
        base: { ref: 'main' },
      },
      comment: {
        body: 'This branch can return early.',
        html_url: 'https://github.com/acme/web/pull/7#discussion_r1',
        user: { login: 'reviewer', id: 2 },
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'reviewer', id: 2 },
    });

    expect(event?.comment).toEqual({
      body: 'This branch can return early.',
      url: 'https://github.com/acme/web/pull/7#discussion_r1',
      kind: 'inline',
    });
  });

  it('treats a GitHub status error as a failed check', () => {
    const event = parseGithubEvent('status', {
      id: 17,
      sha: 'abc123',
      state: 'error',
      context: 'deploy',
      description: 'Deployment errored',
      target_url: 'https://github.com/acme/web/runs/17',
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'deploy-bot', id: 2 },
    });

    expect(event?.checks?.failed).toBe(true);
    expect(event?.activity.state).toBe('error');
  });

  it('treats a GitHub startup failure as a failed check', () => {
    const event = parseGithubEvent('check_suite', {
      action: 'completed',
      check_suite: {
        id: 18,
        status: 'completed',
        conclusion: 'startup_failure',
        head_branch: 'main',
        pull_requests: [{ number: 7 }],
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'github-actions', id: 3 },
    });

    expect(event?.checks?.failed).toBe(true);
    expect(event?.activity.state).toBe('startup_failure');
  });

  it('ignores unrelated events', () => {
    expect(parseGithubEvent('push', {})).toBeNull();
    expect(parseGithubEvent('ping', {})).toBeNull();
  });
});
