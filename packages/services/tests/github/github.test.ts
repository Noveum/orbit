import { describe, expect, it } from 'bun:test';
import {
  canAdvance,
  normalizeGithubCheckEvent,
  notificationTypeForReview,
  notificationTypeForState,
  parseGithubEvent,
  pullRequestState,
  targetCategoryFor,
  verifyGithubSignature,
} from '../../src/github/index.ts';

const CHECK_SHA = '0123456789abcdef0123456789abcdef01234567';
const SUITE_SHA = '123456789abcdef0123456789abcdef012345678';
const WORKFLOW_SHA = '23456789abcdef0123456789abcdef0123456789';
const STATUS_SHA = '3456789abcdef0123456789abcdef0123456789a';
const CHECK_UPDATED_AT = '2026-08-30T08:00:00.000Z';
const CHECK_REPOSITORY = { id: 99, full_name: 'acme/web' };
const CHECK_SENDER = { login: 'github-actions', id: 3 };

function checkRunPayload(
  overrides: {
    readonly app?: unknown;
    readonly headSha?: unknown;
    readonly id?: number;
    readonly name?: unknown;
  } = {},
) {
  return {
    action: 'completed',
    check_run: {
      id: overrides.id ?? 18,
      name: 'name' in overrides ? overrides.name : 'Verify / Linux',
      app: 'app' in overrides ? overrides.app : { id: 15368 },
      head_sha: 'headSha' in overrides ? overrides.headSha : CHECK_SHA,
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/acme/web/runs/18',
      updated_at: CHECK_UPDATED_AT,
    },
    repository: CHECK_REPOSITORY,
    sender: CHECK_SENDER,
  };
}

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

describe('normalizeGithubCheckEvent', () => {
  it('extracts the exact checked commit from every supported event shape', () => {
    const cases = [
      ['check_run', checkRunPayload()],
      [
        'check_suite',
        {
          action: 'completed',
          check_suite: { id: 19, head_sha: SUITE_SHA },
          repository: CHECK_REPOSITORY,
          sender: CHECK_SENDER,
        },
      ],
      [
        'workflow_run',
        {
          action: 'completed',
          workflow_run: { id: 20, head_sha: WORKFLOW_SHA },
          repository: CHECK_REPOSITORY,
          sender: CHECK_SENDER,
        },
      ],
      [
        'status',
        {
          id: 21,
          sha: STATUS_SHA,
          state: 'success',
          context: 'Deploy',
          repository: CHECK_REPOSITORY,
          sender: CHECK_SENDER,
        },
      ],
    ] as const;

    expect(
      cases.map(([eventName, payload]) => {
        const result = normalizeGithubCheckEvent(eventName, payload);
        return result.status === 'normalized' ? result.value.headSha : result;
      }),
    ).toEqual([CHECK_SHA, SUITE_SHA, WORKFLOW_SHA, STATUS_SHA]);
  });

  it('keys check runs by the validated app id and exact non-empty name', () => {
    const original = normalizeGithubCheckEvent('check_run', checkRunPayload());
    const rerun = normalizeGithubCheckEvent(
      'check_run',
      checkRunPayload({ id: 29, name: 'Verify / Linux' }),
    );
    const otherApp = normalizeGithubCheckEvent(
      'check_run',
      checkRunPayload({ app: { id: 15369 } }),
    );
    const otherCase = normalizeGithubCheckEvent(
      'check_run',
      checkRunPayload({ name: 'verify / linux' }),
    );
    const separatorName = normalizeGithubCheckEvent(
      'check_run',
      checkRunPayload({ name: 'Verify:4:test' }),
    );

    expect(original.status).toBe('normalized');
    expect(rerun.status).toBe('normalized');
    expect(otherApp.status).toBe('normalized');
    expect(otherCase.status).toBe('normalized');
    expect(separatorName.status).toBe('normalized');
    if (
      original.status !== 'normalized' ||
      rerun.status !== 'normalized' ||
      otherApp.status !== 'normalized' ||
      otherCase.status !== 'normalized' ||
      separatorName.status !== 'normalized' ||
      original.value.kind !== 'context' ||
      rerun.value.kind !== 'context' ||
      otherApp.value.kind !== 'context' ||
      otherCase.value.kind !== 'context' ||
      separatorName.value.kind !== 'context'
    ) {
      throw new Error('Expected normalized check runs');
    }

    expect(original.value).toMatchObject({
      kind: 'context',
      sourceKind: 'check_run',
      appId: 15368,
      providerContext: 'Verify / Linux',
      providerObjectId: '18',
      state: 'failure',
      status: 'completed',
      conclusion: 'failure',
      providerUpdatedAt: CHECK_UPDATED_AT,
      url: 'https://github.com/acme/web/runs/18',
    });
    expect(rerun.value.contextKey).toBe(original.value.contextKey);
    expect(otherApp.value.contextKey).not.toBe(original.value.contextKey);
    expect(otherCase.value.contextKey).not.toBe(original.value.contextKey);
    expect(separatorName.value.contextKey).not.toBe(original.value.contextKey);
  });

  it('case-folds commit-status contexts independently of the creator', () => {
    const first = normalizeGithubCheckEvent('status', {
      id: 31,
      sha: STATUS_SHA,
      state: 'pending',
      context: 'Deploy/Preview',
      creator: { login: 'old-token', id: 8 },
      repository: CHECK_REPOSITORY,
      sender: CHECK_SENDER,
    });
    const rotated = normalizeGithubCheckEvent('status', {
      id: 32,
      sha: STATUS_SHA,
      state: 'success',
      context: 'deploy/preview',
      creator: { login: 'new-token', id: 9 },
      repository: CHECK_REPOSITORY,
      sender: CHECK_SENDER,
    });

    expect(first.status).toBe('normalized');
    expect(rotated.status).toBe('normalized');
    if (
      first.status !== 'normalized' ||
      rotated.status !== 'normalized' ||
      first.value.kind !== 'context' ||
      rotated.value.kind !== 'context'
    ) {
      throw new Error('Expected normalized commit statuses');
    }

    expect(first.value).toMatchObject({
      kind: 'context',
      sourceKind: 'commit_status',
      providerContext: 'Deploy/Preview',
      creator: { login: 'old-token', id: 8 },
    });
    expect(rotated.value.providerContext).toBe('deploy/preview');
    expect(rotated.value.creator).toEqual({ login: 'new-token', id: 9 });
    expect(rotated.value.contextKey).toBe(first.value.contextKey);
  });

  it('returns quarantine-ready failures for malformed check-run identity', () => {
    const missingApp = normalizeGithubCheckEvent('check_run', checkRunPayload({ app: undefined }));
    const malformedApp = normalizeGithubCheckEvent(
      'check_run',
      checkRunPayload({ app: { id: '15368' } }),
    );
    const missingNamePayload = checkRunPayload();
    const { name: _name, ...checkRunWithoutName } = missingNamePayload.check_run;
    const missingName = normalizeGithubCheckEvent('check_run', {
      ...missingNamePayload,
      check_run: checkRunWithoutName,
    });
    const emptyName = normalizeGithubCheckEvent('check_run', checkRunPayload({ name: '' }));

    expect(missingApp).toEqual({
      status: 'invalid',
      failure: { code: 'invalid_check_run_app', path: 'check_run.app.id' },
    });
    expect(malformedApp).toEqual(missingApp);
    expect(missingName).toEqual({
      status: 'invalid',
      failure: { code: 'invalid_check_run_name', path: 'check_run.name' },
    });
    expect(emptyName).toEqual(missingName);
  });

  it('returns a quarantine-ready failure for a missing or malformed checked commit', () => {
    const missing = normalizeGithubCheckEvent('check_run', checkRunPayload({ headSha: undefined }));
    const malformed = normalizeGithubCheckEvent(
      'check_run',
      checkRunPayload({ headSha: 'not-a-github-sha' }),
    );

    expect(missing).toEqual({
      status: 'invalid',
      failure: { code: 'invalid_head_sha', path: 'check_run.head_sha' },
    });
    expect(malformed).toEqual(missing);
  });

  it('normalizes suites and workflows as reconciliation triggers without context keys', () => {
    const suite = normalizeGithubCheckEvent('check_suite', {
      action: 'completed',
      check_suite: { id: 41, head_sha: SUITE_SHA },
      repository: CHECK_REPOSITORY,
      sender: CHECK_SENDER,
    });
    const workflow = normalizeGithubCheckEvent('workflow_run', {
      action: 'completed',
      workflow_run: { id: 42, head_sha: WORKFLOW_SHA },
      repository: CHECK_REPOSITORY,
      sender: CHECK_SENDER,
    });

    expect(suite).toEqual({
      status: 'normalized',
      value: {
        kind: 'reconciliation_trigger',
        sourceKind: 'check_suite',
        headSha: SUITE_SHA,
        providerObjectId: '41',
        providerUpdatedAt: null,
      },
    });
    expect(workflow).toEqual({
      status: 'normalized',
      value: {
        kind: 'reconciliation_trigger',
        sourceKind: 'workflow_run',
        headSha: WORKFLOW_SHA,
        providerObjectId: '42',
        providerUpdatedAt: null,
      },
    });
  });

  it('distinguishes non-check events from invalid check events', () => {
    expect(normalizeGithubCheckEvent('pull_request', {})).toEqual({ status: 'not_applicable' });
  });
});
