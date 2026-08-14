import { describe, expect, it } from 'bun:test';
import {
  GITHUB_PARSED_EVENTS,
  handlesGithubEvent,
  parseGithubEvent,
} from '../../src/github/index.ts';
import { isGithubInstallationEvent } from '../../src/github/webhook-events.ts';

const SENT_BY_GITHUB = [
  'check_run',
  'check_suite',
  'create',
  'delete',
  'installation',
  'installation_repositories',
  'issue_comment',
  'issues',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'pull_request_review_thread',
  'push',
  'repository',
  'repository_dispatch',
  'status',
  'sub_issues',
  'workflow_job',
  'workflow_run',
];

describe('the events the webhook accepts', () => {
  it('accepts every event a parser exists for', () => {
    for (const eventName of GITHUB_PARSED_EVENTS) {
      expect(handlesGithubEvent(eventName)).toBe(true);
    }
  });

  it('accepts every installation event', () => {
    for (const eventName of ['installation', 'installation_repositories', 'repository']) {
      expect(handlesGithubEvent(eventName)).toBe(true);
    }
  });

  it('turns away the events production actually floods us with', () => {
    const unhandled = SENT_BY_GITHUB.filter((eventName) => !handlesGithubEvent(eventName));

    expect(unhandled).toEqual([
      'create',
      'delete',
      'issues',
      'push',
      'repository_dispatch',
      'sub_issues',
      'workflow_job',
    ]);
  });

  it('never turns away something a parser would have read', () => {
    for (const eventName of SENT_BY_GITHUB) {
      if (handlesGithubEvent(eventName)) continue;
      expect(GITHUB_PARSED_EVENTS).not.toContain(eventName);
      expect(isGithubInstallationEvent(eventName)).toBe(false);
    }
  });

  it('refuses an event that reaches neither', () => {
    expect(handlesGithubEvent('sponsorship')).toBe(false);
    expect(handlesGithubEvent('')).toBe(false);
  });

  it('reads a payload for each parsed event, so the list is not naming dead branches', () => {
    const repository = { id: 99, full_name: 'acme/web' };
    const sender = { login: 'octocat', id: 500 };
    const pullRequest = {
      number: 7,
      title: 'Rework dashboard',
      html_url: 'https://github.com/acme/web/pull/7',
      draft: false,
      merged: false,
      state: 'open',
      head: { ref: 'orb-3-dashboard' },
      base: { ref: 'main' },
      user: sender,
    };

    expect(
      parseGithubEvent('pull_request', {
        action: 'opened',
        pull_request: pullRequest,
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('issue_comment', {
        action: 'created',
        issue: {
          number: 7,
          title: pullRequest.title,
          html_url: pullRequest.html_url,
          pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/7' },
        },
        comment: {
          id: 71,
          body: 'Please add a test.',
          html_url: `${pullRequest.html_url}#issuecomment-71`,
          user: sender,
        },
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('issue_comment', {
        action: 'created',
        issue: {
          number: 7,
          title: pullRequest.title,
          html_url: 'https://github.com/acme/web/issues/7',
        },
        comment: {
          id: 72,
          body: 'This is an issue comment.',
          html_url: 'https://github.com/acme/web/issues/7#issuecomment-72',
          user: sender,
        },
        repository,
        sender,
      }),
    ).toBeNull();
    expect(
      parseGithubEvent('pull_request_review', {
        action: 'submitted',
        review: { state: 'approved', html_url: pullRequest.html_url, user: sender },
        pull_request: pullRequest,
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('check_suite', {
        action: 'completed',
        check_suite: {
          conclusion: 'failure',
          head_branch: 'orb-3',
          pull_requests: [{ number: 7 }],
        },
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('check_run', {
        action: 'completed',
        check_run: {
          id: 81,
          name: 'verify',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/acme/web/runs/81',
          head_sha: 'abc123',
          pull_requests: [{ number: 7 }],
          check_suite: { head_branch: 'orb-3' },
        },
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('status', {
        id: 82,
        sha: 'abc123',
        state: 'failure',
        context: 'deploy/preview',
        description: 'Preview failed',
        target_url: 'https://example.com/status/82',
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('workflow_run', {
        action: 'completed',
        workflow_run: {
          id: 83,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/acme/web/actions/runs/83',
          head_branch: 'orb-3',
          head_sha: 'abc123',
          pull_requests: [{ number: 7 }],
        },
        repository,
        sender,
      }),
    ).not.toBeNull();
    expect(
      parseGithubEvent('pull_request_review_thread', {
        action: 'resolved',
        thread: { id: 84, resolved_by: sender, updated_at: '2026-08-13T00:00:00.000Z' },
        pull_request: pullRequest,
        repository,
        sender,
      }),
    ).not.toBeNull();
  });
});
