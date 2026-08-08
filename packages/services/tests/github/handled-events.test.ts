import { describe, expect, it } from 'bun:test';
import { parseGithubEvent } from '../../src/github/index.ts';
import {
  GITHUB_PARSED_EVENTS,
  handlesGithubEvent,
  isGithubInstallationEvent,
} from '../../src/github/webhook-events.ts';

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

function payloadFor(eventName: string): unknown {
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

  if (eventName === 'check_suite') {
    return {
      action: 'completed',
      check_suite: { conclusion: 'failure', head_branch: 'orb-3', pull_requests: [{ number: 7 }] },
      repository,
      sender,
    };
  }
  if (eventName === 'pull_request_review') {
    return {
      action: 'submitted',
      review: { state: 'approved', html_url: pullRequest.html_url, user: sender },
      pull_request: pullRequest,
      repository,
      sender,
    };
  }
  return { action: 'opened', pull_request: pullRequest, repository, sender };
}

describe('the handled event list', () => {
  it('names exactly the events parseGithubEvent can read', () => {
    for (const eventName of GITHUB_PARSED_EVENTS) {
      expect(parseGithubEvent(eventName, payloadFor(eventName))).not.toBeNull();
    }
  });

  it('does not drop an event that some handler would have read', () => {
    for (const eventName of SENT_BY_GITHUB) {
      if (handlesGithubEvent(eventName)) continue;
      expect(parseGithubEvent(eventName, payloadFor(eventName))).toBeNull();
      expect(isGithubInstallationEvent(eventName)).toBe(false);
    }
  });

  it('handles every installation event and every parsed event', () => {
    for (const eventName of [...GITHUB_PARSED_EVENTS, 'installation', 'repository']) {
      expect(handlesGithubEvent(eventName)).toBe(true);
    }
  });

  it('refuses an event GitHub never sends us', () => {
    expect(handlesGithubEvent('sponsorship')).toBe(false);
    expect(handlesGithubEvent('')).toBe(false);
  });
});
