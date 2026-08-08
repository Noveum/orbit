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
      'check_run',
      'create',
      'delete',
      'issues',
      'pull_request_review_comment',
      'pull_request_review_thread',
      'push',
      'repository_dispatch',
      'status',
      'sub_issues',
      'workflow_job',
      'workflow_run',
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
  });
});
