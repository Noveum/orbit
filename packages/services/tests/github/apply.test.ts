import { describe, expect, it } from 'bun:test';
import { db } from '@orbit/db';
import {
  account,
  githubCheckActivity,
  githubCheckHeadContext,
  githubCheckHeadReconciliation,
  githubPullRequest,
  githubPullRequestActivity,
  githubPullRequestReconciliation,
  githubRepositorySync,
  gitLink,
  integration,
  issue,
  issueReviewer,
  member,
  notification,
  notificationSourceEvent,
  organization,
  team,
  teamMember,
  user,
  webhookDelivery,
  workflowState,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq } from 'drizzle-orm';
import { applyGithubEvent, upsertGithubPullRequestHistory } from '../../src/github/apply.ts';
import { notifyMany } from '../../src/notifications/index.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

interface Fixture {
  readonly organizationId: string;
  readonly teamId: string;
  readonly issueId: string;
  readonly creatorId: string;
  readonly assigneeId: string;
  readonly states: Record<string, string>;
}

const STATES: readonly { name: string; category: string; position: number }[] = [
  { name: 'Backlog', category: 'backlog', position: 1 },
  { name: 'Todo', category: 'unstarted', position: 2 },
  { name: 'In Progress', category: 'started', position: 3 },
  { name: 'In Review', category: 'review', position: 4 },
  { name: 'Done', category: 'completed', position: 5 },
  { name: 'Canceled', category: 'canceled', position: 6 },
];

const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const NEXT_HEAD_SHA = '123456789abcdef0123456789abcdef012345678';
const SHARED_HEAD_SHA = '23456789abcdef0123456789abcdef0123456789';

async function seed(tx: TestTransaction, startState = 'Backlog'): Promise<Fixture> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  await tx
    .insert(organization)
    .values({ id: organizationId, name: 'Acme', slug: `acme-${suffix.toLowerCase()}` });

  const people = ['creator', 'assignee'].map((label) => ({
    id: `usr_${label}_${suffix}`,
    name: label,
    email: `${label}.${suffix}@orbit.local`,
    handle: `${label}-${suffix.toLowerCase()}`,
  }));
  await tx.insert(user).values(people);

  const creatorId = `usr_creator_${suffix}`;
  const assigneeId = `usr_assignee_${suffix}`;
  await tx.insert(account).values([
    {
      id: `acc_creator_${suffix}`,
      accountId: '500',
      providerId: 'github',
      userId: creatorId,
    },
    {
      id: `acc_assignee_${suffix}`,
      accountId: '900',
      providerId: 'github',
      userId: assigneeId,
    },
  ]);
  await tx.insert(member).values([
    {
      id: `mem_creator_${suffix}`,
      organizationId,
      userId: creatorId,
      role: 'member',
    },
    {
      id: `mem_assignee_${suffix}`,
      organizationId,
      userId: assigneeId,
      role: 'member',
    },
  ]);

  const teamId = `team_${suffix}`;
  await tx.insert(team).values({ id: teamId, organizationId, name: 'Engineering', key: 'ENG' });
  await tx.insert(teamMember).values([
    { id: `tm_creator_${suffix}`, teamId, userId: creatorId },
    { id: `tm_assignee_${suffix}`, teamId, userId: assigneeId },
  ]);

  const states: Record<string, string> = {};
  await tx.insert(workflowState).values(
    STATES.map((state) => {
      const id = `st_${state.category}_${suffix}`;
      states[state.name] = id;
      return {
        id,
        organizationId,
        teamId,
        name: state.name,
        category: state.category,
        color: '#888',
        position: state.position,
      };
    }),
  );

  const issueId = `iss_${suffix}`;
  const stateId = states[startState];
  if (stateId === undefined) throw new Error('missing start state');
  await tx.insert(issue).values({
    id: issueId,
    organizationId,
    teamId,
    number: 3,
    identifier: 'ENG-3',
    title: 'Dashboard',
    stateId,
    creatorId,
    assigneeId,
  });
  await tx.insert(issueReviewer).values({ issueId, userId: creatorId });

  const integrationId = `int_${suffix}`;
  await tx.insert(integration).values({
    id: integrationId,
    organizationId,
    provider: 'github',
    externalId: 'inst-1',
    connectedById: creatorId,
  });
  await tx.insert(githubRepositorySync).values({
    id: `repo_${suffix}`,
    organizationId,
    integrationId,
    teamId,
    repositoryId: '99',
    repositoryName: 'acme/web',
  });

  return { organizationId, teamId, issueId, creatorId, assigneeId, states };
}

function prEvent(overrides: {
  action?: string;
  draft?: boolean;
  merged?: boolean;
  state?: 'open' | 'closed';
  title?: string;
  headRef?: string;
  headSha?: string;
  body?: string;
  number?: number;
  externalId?: number;
  updatedAt?: string;
  author?: { readonly login: string; readonly id: number };
}): { eventName: string; body: unknown } {
  const number = overrides.number ?? 7;
  return {
    eventName: 'pull_request',
    body: {
      action: overrides.action ?? 'opened',
      pull_request: {
        id: overrides.externalId ?? 7007,
        number,
        title: overrides.title ?? 'Rework dashboard',
        body: overrides.body ?? null,
        html_url: `https://github.com/acme/web/pull/${number}`,
        draft: overrides.draft ?? false,
        merged: overrides.merged ?? false,
        state: overrides.state ?? 'open',
        head: {
          ref: overrides.headRef ?? 'eng-3-dashboard',
          sha: overrides.headSha ?? HEAD_SHA,
        },
        base: { ref: 'main' },
        user: overrides.author ?? { login: 'octocat', id: 500 },
        created_at: '2026-08-13T01:00:00.000Z',
        updated_at: overrides.updatedAt ?? '2026-08-13T02:00:00.000Z',
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'octocat', id: 500 },
    },
  };
}

function checkRunEvent(input: {
  readonly id: number;
  readonly name: string;
  readonly conclusion: string;
  readonly headSha?: string;
  readonly appId?: number;
  readonly completedAt?: string;
  readonly pullRequestNumbers?: readonly number[];
}): { eventName: string; body: unknown } {
  return {
    eventName: 'check_run',
    body: {
      action: 'completed',
      check_run: {
        id: input.id,
        name: input.name,
        app: { id: input.appId ?? 10 },
        status: 'completed',
        conclusion: input.conclusion,
        html_url: `https://github.com/acme/web/actions/runs/${input.id}`,
        head_sha: input.headSha ?? HEAD_SHA,
        pull_requests: (input.pullRequestNumbers ?? [7]).map((number) => ({ number })),
        check_suite: { head_branch: 'eng-3-dashboard' },
        completed_at: input.completedAt ?? `2026-08-13T05:${input.id}:00.000Z`,
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'ci', id: 3 },
    },
  };
}

function statusEvent(input: {
  readonly id: number;
  readonly context: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly headSha?: string;
}): { eventName: string; body: unknown } {
  return {
    eventName: 'status',
    body: {
      id: input.id,
      sha: input.headSha ?? HEAD_SHA,
      state: input.state,
      context: input.context,
      target_url: `https://github.com/acme/web/statuses/${input.id}`,
      updated_at: input.updatedAt,
      repository: { id: 99, full_name: 'acme/web' },
      creator: { login: 'deploy-bot', id: 13 },
      sender: { login: 'deploy-bot', id: 13 },
    },
  };
}

async function applyCheckEvent(
  tx: TestTransaction,
  organizationId: string,
  event: { readonly eventName: string; readonly body: unknown },
) {
  const webhookDeliveryId = `whd_${randomUUIDv7()}`;
  await tx.insert(webhookDelivery).values({
    id: webhookDeliveryId,
    provider: 'github',
    deliveryId: `delivery_${randomUUIDv7()}`,
    event: event.eventName,
    organizationId,
    status: 'processing',
  });
  return await applyGithubEvent(tx, {
    ...event,
    organizationId,
    webhookDeliveryId,
  });
}

async function markHeadAuthoritative(tx: TestTransaction, organizationId: string): Promise<void> {
  await tx
    .update(githubCheckHeadReconciliation)
    .set({ status: 'completed' })
    .where(eq(githubCheckHeadReconciliation.organizationId, organizationId));
}

async function currentStateName(tx: TestTransaction, issueId: string): Promise<string> {
  const [row] = await tx
    .select({ name: workflowState.name })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(eq(issue.id, issueId))
    .limit(1);
  return row?.name ?? 'unknown';
}

describe('applyGithubEvent', () => {
  it('ignores a repository that is not linked', async () => {
    await withRollback(async (tx) => {
      const result = await applyGithubEvent(tx, {
        eventName: 'pull_request',
        body: {
          action: 'opened',
          pull_request: {
            number: 1,
            title: 'x',
            html_url: 'https://x',
            head: { ref: 'eng-3' },
            base: { ref: 'main' },
          },
          repository: { id: 12345, full_name: 'nobody/repo' },
          sender: { login: 'x', id: 1 },
        },
      });
      expect(result.handled).toBe(false);
      expect(result.actions).toHaveLength(0);
    });
  });

  it('keeps same-number pull requests from different repositories separate', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx.insert(gitLink).values({
        id: randomUUIDv7(),
        organizationId: fixture.organizationId,
        issueId: fixture.issueId,
        kind: 'pull_request',
        externalId: `legacy:${randomUUIDv7()}`,
        number: 7,
        repository: 'acme/api',
        url: 'https://github.com/acme/api/pull/7',
      });

      await applyGithubEvent(tx, prEvent({}));

      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links.map((link) => link.repository).sort()).toEqual(['acme/api', 'acme/web']);
    });
  });

  it('ignores an identifier that is only mentioned, not declared', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);

      const result = await applyGithubEvent(
        tx,
        prEvent({
          headRef: 'chore/tidy',
          title: 'Tidy the dashboard',
          body: 'This looks a lot like ENG-3 but is a separate piece of work.',
        }),
      );

      expect(result.handled).toBe(true);
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links).toHaveLength(0);
    });
  });

  it('ignores an identifier inside a code block, a comment or a quote', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);

      const result = await applyGithubEvent(
        tx,
        prEvent({
          headRef: 'chore/tidy',
          title: 'Tidy the dashboard',
          body: [
            '<!-- Template: write "Fixes ENG-3" here -->',
            '```',
            'git checkout -b fixes-eng-3',
            '```',
            'Inline `Fixes ENG-3` in backticks.',
            '> Somebody quoted: Fixes ENG-3',
          ].join('\n'),
        }),
      );

      expect(result.handled).toBe(true);
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links).toHaveLength(0);
    });
  });

  it('links an issue named only in the pull request description', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);

      const result = await applyGithubEvent(
        tx,
        prEvent({
          headRef: 'chore/no-identifier-here',
          title: 'Tidy the dashboard',
          body: 'Rewrites the panel.\n\nFixes ENG-3, which nothing else in this PR names.',
        }),
      );

      expect(result.handled).toBe(true);
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links).toHaveLength(1);
    });
  });

  it('mirrors an unlinked pull request when no identifier appears anywhere', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);

      const result = await applyGithubEvent(
        tx,
        prEvent({
          headRef: 'chore/tidy',
          title: 'Tidy the dashboard',
          body: 'No identifier in here at all.',
        }),
      );

      expect(result.handled).toBe(true);
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links).toHaveLength(0);
      const pulls = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pulls).toHaveLength(1);
      expect(pulls[0]?.repositoryId).toBe('99');
      expect(pulls[0]?.number).toBe(7);
      expect(pulls[0]?.title).toBe('Tidy the dashboard');
      expect(result.ignoredReason).toBeNull();
      expect(result.teamIds).toEqual([fixture.teamId]);
      const [reconciliation] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));
      expect(reconciliation?.status).toBe('pending');
      expect(reconciliation?.triggerKind).toBe('pull_request_mirrored');
      expect(reconciliation?.jobVersion).toBe(1);
    });
  });

  it('waits for a complete pull snapshot before reconciling a comment-first pull request', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, {
        eventName: 'issue_comment',
        body: {
          action: 'created',
          issue: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/7' },
          },
          comment: {
            id: 701,
            body: 'Please add a regression test.',
            html_url: 'https://github.com/acme/web/pull/7#issuecomment-701',
            created_at: '2026-08-13T02:00:00.000Z',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'reviewer', id: 901 },
        },
        organizationId: fixture.organizationId,
        now: new Date('2026-08-13T02:00:00.000Z'),
      });

      expect(
        await tx
          .select()
          .from(githubCheckHeadReconciliation)
          .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId)),
      ).toEqual([]);
      const [partialPull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(partialPull?.headSha).toBe('');
      expect(partialPull?.providerUpdatedAt).toBeNull();

      await applyGithubEvent(tx, {
        ...prEvent({ updatedAt: '2026-08-13T01:00:00.000Z' }),
        organizationId: fixture.organizationId,
        now: new Date('2026-08-13T02:01:00.000Z'),
      });

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      const jobs = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));
      expect(pull?.headSha).toBe(HEAD_SHA);
      expect(pull?.headEpoch).toBe(1);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.headSha).toBe(HEAD_SHA);
      expect(jobs[0]?.status).toBe('pending');
    });
  });

  it('links a draft PR and moves the issue to the mapped started state', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const result = await applyGithubEvent(tx, prEvent({ draft: true }));

      expect(result.handled).toBe(true);
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links).toHaveLength(1);
      expect(links[0]?.state).toBe('draft');
      expect(links[0]?.draft).toBe(true);
      expect(await currentStateName(tx, fixture.issueId)).toBe('In Progress');
      expect(result.actions.some((action) => action.model === 'git_link')).toBe(true);
      const issueAction = result.actions.find((action) => action.model === 'issue');
      expect(issueAction?.data['reviewerIds']).toEqual([fixture.creatorId]);
      expect(result.notificationEvents).toHaveLength(0);
    });
  });

  it('is idempotent when the same PR event is delivered twice', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await applyGithubEvent(tx, prEvent({}));
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links).toHaveLength(1);
    });
  });

  it('keeps distinct lifecycle events for the same pull request', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      const opened = prEvent({
        headRef: 'chore/tidy',
        title: 'Tidy the dashboard',
        body: 'No Orbit identifier.',
      });
      const ready = prEvent({
        action: 'ready_for_review',
        headRef: 'chore/tidy',
        title: 'Tidy the dashboard',
        body: 'No Orbit identifier.',
      });

      const applied = await applyGithubEvent(tx, opened);
      await applyGithubEvent(tx, ready);

      const pullRequestId = applied.pullRequests[0]?.id;
      if (pullRequestId === undefined) throw new Error('the mirrored pull request is missing');
      const activities = await tx
        .select()
        .from(githubPullRequestActivity)
        .where(eq(githubPullRequestActivity.pullRequestId, pullRequestId));

      expect(activities.map((activity) => activity.action).sort()).toEqual([
        'opened',
        'ready_for_review',
      ]);
    });
  });

  it('never moves a Done issue backwards when the PR merges', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'Done');
      const result = await applyGithubEvent(
        tx,
        prEvent({ action: 'closed', merged: true, state: 'closed' }),
      );
      expect(await currentStateName(tx, fixture.issueId)).toBe('Done');
      expect(result.actions.some((action) => action.model === 'issue')).toBe(false);
      const links = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(links[0]?.merged).toBe(true);
      expect(links[0]?.state).toBe('merged');
      expect(result.notificationEvents.some((event) => event.type === 'pr_merged')).toBe(true);
    });
  });

  it('moves an In Progress issue to review when a review is approved and notifies the audience', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'In Progress');
      const result = await applyGithubEvent(tx, {
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: { state: 'approved', html_url: 'https://x/r', user: { login: 'rev', id: 900 } },
          pull_request: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            head: { ref: 'eng-3-dashboard' },
            base: { ref: 'main' },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });
      expect(await currentStateName(tx, fixture.issueId)).toBe('In Review');
      expect(result.notificationEvents.some((event) => event.type === 'pr_approved')).toBe(true);
      const [event] = result.notificationEvents;
      expect(event?.userIds).toContain(fixture.creatorId);
      expect(event?.userIds).toContain(fixture.assigneeId);
    });
  });

  it('does not move an In Review issue backwards when changes are requested', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'In Review');
      const result = await applyGithubEvent(tx, {
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: { state: 'changes_requested', user: { login: 'rev', id: 900 } },
          pull_request: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            head: { ref: 'eng-3-dashboard' },
            base: { ref: 'main' },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });
      expect(await currentStateName(tx, fixture.issueId)).toBe('In Review');
      expect(result.notificationEvents.some((event) => event.type === 'pr_review_submitted')).toBe(
        true,
      );
    });
  });

  it('queues a check suite and notifies on its constituent check transition', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'In Progress');
      const requested = await applyGithubEvent(tx, {
        eventName: 'pull_request',
        body: {
          action: 'review_requested',
          pull_request: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            head: { ref: 'eng-3-dashboard', sha: HEAD_SHA },
            base: { ref: 'main' },
          },
          repository: { id: 99, full_name: 'acme/web' },
          requested_reviewer: { login: 'rev', id: 900 },
          sender: { login: 'octocat', id: 500 },
        },
      });
      expect(
        requested.notificationEvents.some((event) => event.type === 'pr_review_requested'),
      ).toBe(true);

      const suite = await applyGithubEvent(tx, {
        eventName: 'check_suite',
        body: {
          action: 'completed',
          check_suite: {
            id: 80,
            conclusion: 'error',
            head_branch: 'eng-3-dashboard',
            head_sha: HEAD_SHA,
            pull_requests: [{ number: 7 }],
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'ci', id: 3 },
        },
      });
      expect(suite.notificationEvents).toEqual([]);
      const [queuedSuite] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));
      expect(queuedSuite).toMatchObject({
        headSha: HEAD_SHA,
        status: 'pending',
        triggerKind: 'check_suite',
        triggerIdentity: '80',
      });
      const checks = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 81,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:00:00.000Z',
        }),
      );
      expect(checks.notificationEvents.some((event) => event.type === 'pr_checks_failed')).toBe(
        true,
      );
      const [failedPull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(failedPull?.checkStatus).toBe('failure');

      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 82,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T06:00:00.000Z',
        }),
      );
      const [recoveredPull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(recoveredPull?.checkStatus).toBe('failure');
      expect(await currentStateName(tx, fixture.issueId)).toBe('In Review');
    });
  });

  it('resets the retry budget and settle window for every new head job version', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      const suiteBody = (id: number) => ({
        action: 'completed',
        check_suite: {
          id,
          conclusion: 'failure',
          head_sha: HEAD_SHA,
          pull_requests: [{ number: 7 }],
        },
        repository: { id: 99, full_name: 'acme/web' },
        sender: { login: 'ci', id: 3 },
      });
      await applyGithubEvent(tx, { eventName: 'check_suite', body: suiteBody(180) });
      await tx
        .update(githubCheckHeadReconciliation)
        .set({
          status: 'failed',
          attempts: 8,
          settleDeadline: new Date('2026-08-12T00:00:00.000Z'),
        })
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));

      await applyGithubEvent(tx, { eventName: 'check_suite', body: suiteBody(181) });

      const [head] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));
      expect(head?.status).toBe('pending');
      expect(head?.jobVersion).toBe(3);
      expect(head?.attempts).toBe(0);
      expect(head?.settleDeadline).toBeNull();
      expect(head?.lastError).toBeNull();
    });
  });

  it('does not clear a legacy failure before its bootstrap head snapshot is accepted', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await tx
        .update(githubCheckHeadReconciliation)
        .set({ status: 'pending', triggerKind: 'migration_bootstrap' })
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));
      await tx
        .update(githubPullRequest)
        .set({ checkStatus: 'failure' })
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));

      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 182,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T06:02:00.000Z',
        }),
      );

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.checkStatus).toBe('failure');
    });
  });

  it('canonicalizes a failed check notification for every linked pull request', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'In Progress');
      const stateId = fixture.states['In Progress'];
      if (stateId === undefined) throw new Error('the in progress state is missing');
      const secondIssueId = `iss_${randomUUIDv7()}`;
      await tx.insert(issue).values({
        id: secondIssueId,
        organizationId: fixture.organizationId,
        teamId: fixture.teamId,
        number: 4,
        identifier: 'ENG-4',
        title: 'Related checks',
        stateId,
        creatorId: fixture.assigneeId,
      });

      await applyGithubEvent(
        tx,
        prEvent({
          headRef: 'eng-3-dashboard',
          headSha: SHARED_HEAD_SHA,
          body: 'Fixes ENG-3',
        }),
      );
      await applyGithubEvent(
        tx,
        prEvent({
          number: 8,
          externalId: 8008,
          title: 'Related checks',
          headRef: 'eng-4-related-checks',
          headSha: SHARED_HEAD_SHA,
          body: 'Fixes ENG-4',
          author: { login: 'assignee', id: 900 },
        }),
      );

      const result = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 303,
          name: 'verify',
          conclusion: 'failure',
          headSha: SHARED_HEAD_SHA,
          pullRequestNumbers: [7, 8],
          completedAt: '2026-08-13T06:00:00.000Z',
        }),
      );

      expect(result.notificationEvents).toHaveLength(2);
      const first = result.notificationEvents.find(
        (event) => event.source?.subjectKey === 'github-pr:99:7',
      );
      const second = result.notificationEvents.find(
        (event) => event.source?.subjectKey === 'github-pr:99:8',
      );
      expect(first?.entityId).toBe(result.pullRequests.find((pull) => pull.number === 7)?.id);
      expect(first?.userIds).toEqual([fixture.creatorId, fixture.assigneeId]);
      expect(second?.entityId).toBe(result.pullRequests.find((pull) => pull.number === 8)?.id);
      expect(second?.userIds).toEqual([fixture.assigneeId]);
    });
  });

  it('includes a mapped pull request author in a linked failed-check audience', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const suffix = randomUUIDv7();
      const authorId = `usr_author_${suffix}`;
      await tx.insert(user).values({
        id: authorId,
        name: 'Pull author',
        email: `pull-author.${suffix}@orbit.local`,
        handle: `pull-author-${suffix.toLowerCase()}`,
      });
      await tx.insert(account).values({
        id: `acc_author_${suffix}`,
        accountId: '901',
        providerId: 'github',
        userId: authorId,
      });
      await tx.insert(member).values({
        id: `mem_author_${suffix}`,
        organizationId: fixture.organizationId,
        userId: authorId,
        role: 'member',
      });
      await applyGithubEvent(
        tx,
        prEvent({ body: 'Fixes ENG-3', author: { login: 'pull-author', id: 901 } }),
      );

      const failed = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 304,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T06:10:00.000Z',
        }),
      );

      expect(failed.notificationEvents).toHaveLength(1);
      expect(failed.notificationEvents[0]?.userIds.sort()).toEqual(
        [fixture.creatorId, fixture.assigneeId, authorId].sort(),
      );
    });
  });

  it('rolls up concurrent checks and ignores an older retry result', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await markHeadAuthoritative(tx, fixture.organizationId);
      const checkRun = (input: {
        readonly id: number;
        readonly name: string;
        readonly conclusion: string;
        readonly completedAt: string;
      }) => ({
        eventName: 'check_run',
        body: {
          action: 'completed',
          check_run: {
            id: input.id,
            name: input.name,
            app: { id: 10 },
            status: 'completed',
            conclusion: input.conclusion,
            html_url: `https://github.com/acme/web/actions/runs/${input.id}`,
            head_sha: HEAD_SHA,
            pull_requests: [{ number: 7 }],
            check_suite: { head_branch: 'eng-3-dashboard' },
            completed_at: input.completedAt,
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'ci', id: 3 },
        },
      });

      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRun({
          id: 81,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:00:00.000Z',
        }),
      );
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRun({
          id: 82,
          name: 'lint',
          conclusion: 'success',
          completedAt: '2026-08-13T06:00:00.000Z',
        }),
      );

      let [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.checkStatus).toBe('failure');

      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRun({
          id: 81,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T07:00:00.000Z',
        }),
      );
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRun({
          id: 81,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:00:00.000Z',
        }),
      );

      [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.checkStatus).toBe('success');
    });
  });

  it('keeps an old-head failure from changing the current pull request after a force push', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await applyGithubEvent(
        tx,
        prEvent({
          action: 'synchronize',
          headSha: NEXT_HEAD_SHA,
          updatedAt: '2026-08-13T03:00:00.000Z',
        }),
      );

      const oldHead = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 91,
          name: 'verify',
          conclusion: 'failure',
          headSha: HEAD_SHA,
          completedAt: '2026-08-13T04:00:00.000Z',
        }),
      );

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.headSha).toBe(NEXT_HEAD_SHA);
      expect(pull?.checkStatus).toBe('unknown');
      expect(oldHead.notificationEvents).toEqual([]);
    });
  });

  it('binds a check that arrives before its head becomes current', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 97,
          name: 'verify',
          conclusion: 'failure',
          headSha: NEXT_HEAD_SHA,
          completedAt: '2026-08-13T02:30:00.000Z',
        }),
      );

      const synchronized = await applyGithubEvent(
        tx,
        prEvent({
          action: 'synchronize',
          headSha: NEXT_HEAD_SHA,
          updatedAt: '2026-08-13T03:00:00.000Z',
        }),
      );

      expect(synchronized.pullRequests[0]?.headSha).toBe(NEXT_HEAD_SHA);
      expect(synchronized.pullRequests[0]?.checkStatus).toBe('failure');
      expect(
        synchronized.notificationEvents.filter((event) => event.type === 'pr_checks_failed'),
      ).toHaveLength(1);
      const [reconciliation] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(
          and(
            eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId),
            eq(githubCheckHeadReconciliation.headSha, NEXT_HEAD_SHA),
          ),
        );
      expect(reconciliation?.status).toBe('pending');
    });
  });

  it('emits a failure transition only when the current-head aggregate enters failure', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));

      const firstFailure = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 92,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:00:00.000Z',
        }),
      );
      const secondFailure = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 93,
          name: 'lint',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:01:00.000Z',
        }),
      );
      const partialRecovery = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 94,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T05:02:00.000Z',
        }),
      );

      expect(
        firstFailure.notificationEvents.filter((event) => event.type === 'pr_checks_failed'),
      ).toHaveLength(1);
      expect(
        secondFailure.notificationEvents.filter((event) => event.type === 'pr_checks_failed'),
      ).toHaveLength(0);
      expect(
        partialRecovery.notificationEvents.filter((event) => event.type === 'pr_checks_failed'),
      ).toHaveLength(0);
    });
  });

  it('binds a check received before its pull request is mirrored', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const beforePull = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 95,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T01:30:00.000Z',
        }),
      );
      expect(beforePull.pullRequests).toEqual([]);
      expect(beforePull.notificationEvents).toEqual([]);

      const mirrored = await applyGithubEvent(tx, prEvent({}));
      expect(mirrored.pullRequests[0]?.checkStatus).toBe('failure');
      expect(mirrored.notificationEvents.some((event) => event.type === 'pr_checks_failed')).toBe(
        true,
      );

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.headSha).toBe(HEAD_SHA);
      expect(pull?.checkStatus).toBe('failure');
    });
  });

  it('tracks shared-head pull request projections independently', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const stateId = fixture.states['Backlog'];
      if (stateId === undefined) throw new Error('the backlog state is missing');
      await tx.insert(issue).values({
        id: `iss_${randomUUIDv7()}`,
        organizationId: fixture.organizationId,
        teamId: fixture.teamId,
        number: 4,
        identifier: 'ENG-4',
        title: 'Shared head work',
        stateId,
        creatorId: fixture.creatorId,
        assigneeId: fixture.assigneeId,
      });
      await applyGithubEvent(tx, prEvent({ body: 'Fixes ENG-3', headSha: SHARED_HEAD_SHA }));
      await applyGithubEvent(
        tx,
        prEvent({
          number: 8,
          externalId: 8008,
          body: 'Fixes ENG-4',
          headSha: SHARED_HEAD_SHA,
        }),
      );

      const result = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 96,
          name: 'verify',
          conclusion: 'failure',
          headSha: SHARED_HEAD_SHA,
          pullRequestNumbers: [7, 8],
          completedAt: '2026-08-13T05:05:00.000Z',
        }),
      );

      expect(result.pullRequests.map((pull) => pull.number).sort()).toEqual([7, 8]);
      expect(result.pullRequests.every((pull) => pull.checkStatus === 'failure')).toBe(true);
      expect(
        result.notificationEvents.filter((event) => event.type === 'pr_checks_failed'),
      ).toHaveLength(2);
      expect(new Set(result.notificationEvents.map((event) => event.source?.subjectKey)).size).toBe(
        2,
      );
    });
  });

  it('marks an equal-time conflicting context unresolved without changing the pull', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      const occurredAt = '2026-08-13T05:10:00.000Z';
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({ id: 101, name: 'verify', conclusion: 'failure', completedAt: occurredAt }),
      );
      const conflict = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({ id: 102, name: 'verify', conclusion: 'success', completedAt: occurredAt }),
      );

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      const [context] = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(eq(githubCheckHeadContext.organizationId, fixture.organizationId));
      const [reconciliation] = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));

      expect(pull?.checkStatus).toBe('failure');
      expect(context?.state).toBe('failure');
      expect(context?.reconciliationState).toBe('unresolved');
      expect(reconciliation?.status).toBe('pending');
      expect(conflict.notificationEvents).toEqual([]);
    });
  });

  it('updates one case-folded commit-status context across creator identity changes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await markHeadAuthoritative(tx, fixture.organizationId);
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        statusEvent({
          id: 111,
          context: 'Deploy/Preview',
          state: 'pending',
          updatedAt: '2026-08-13T05:11:00.000Z',
        }),
      );
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        statusEvent({
          id: 112,
          context: 'deploy/preview',
          state: 'success',
          updatedAt: '2026-08-13T05:12:00.000Z',
        }),
      );

      const contexts = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(eq(githubCheckHeadContext.organizationId, fixture.organizationId));
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      const activities = await tx
        .select()
        .from(githubCheckActivity)
        .where(eq(githubCheckActivity.organizationId, fixture.organizationId));

      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.state).toBe('success');
      expect(contexts[0]?.contextVersion).toBe(2);
      expect(pull?.checkStatus).toBe('success');
      expect(
        activities.find((activity) => activity.providerObjectId === '112')?.payload['creator'],
      ).toEqual({ login: 'deploy-bot', id: 13 });
    });
  });

  it('keeps same-name check runs from different apps as separate contexts', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 121,
          appId: 10,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T05:13:00.000Z',
        }),
      );
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 122,
          appId: 20,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:14:00.000Z',
        }),
      );

      const contexts = await tx
        .select()
        .from(githubCheckHeadContext)
        .where(eq(githubCheckHeadContext.organizationId, fixture.organizationId));
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));

      expect(contexts).toHaveLength(2);
      expect(new Set(contexts.map((context) => context.contextKey)).size).toBe(2);
      expect(pull?.checkStatus).toBe('failure');
    });
  });

  it('uses one coarse source key for repeated failure transitions on the same head', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await markHeadAuthoritative(tx, fixture.organizationId);
      const firstFailure = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 131,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:15:00.000Z',
        }),
      );
      await notifyMany(tx, firstFailure.notificationEvents, { slackEnabled: false });
      await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 132,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T05:16:00.000Z',
        }),
      );
      const secondFailure = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 133,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:17:00.000Z',
        }),
      );
      const repeated = await notifyMany(tx, secondFailure.notificationEvents, {
        slackEnabled: false,
      });

      expect(firstFailure.notificationEvents).toHaveLength(1);
      expect(secondFailure.notificationEvents).toHaveLength(1);
      expect(secondFailure.notificationEvents[0]?.source?.sourceEventKey).toBe(
        firstFailure.notificationEvents[0]?.source?.sourceEventKey,
      );
      expect(firstFailure.notificationEvents[0]?.source?.sourceEventKey).toBe(
        `github-pr:99:7:${HEAD_SHA}:checks-failed`,
      );
      const sources = await tx
        .select()
        .from(notificationSourceEvent)
        .where(eq(notificationSourceEvent.organizationId, fixture.organizationId));
      const recipients = await tx
        .select()
        .from(notification)
        .where(eq(notification.organizationId, fixture.organizationId));
      expect(sources).toHaveLength(1);
      expect(recipients).toHaveLength(2);
      expect(repeated.notifications).toEqual([]);
    });
  });

  it('keeps an unrecognized check conclusion unknown', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const applied = await applyGithubEvent(tx, prEvent({}));
      const pullRequestId = applied.pullRequests[0]?.id;
      if (pullRequestId === undefined) throw new Error('the mirrored pull request is missing');

      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries: [
          {
            externalId: 'check_run:83:completed:mysterious',
            type: 'checks',
            actor: { login: 'github-actions', id: 0 },
            body: 'verify',
            url: 'https://github.com/acme/web/actions/runs/83',
            state: 'mysterious',
            path: null,
            line: null,
            occurredAt: '2026-08-13T08:00:00.000Z',
          },
        ],
      });

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, pullRequestId));
      expect(pull?.checkStatus).toBe('unknown');
    });
  });

  it('notifies an existing linked pull request about a conversation comment', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      await applyGithubEvent(tx, prEvent({}));

      const result = await applyGithubEvent(tx, {
        eventName: 'issue_comment',
        body: {
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
            user: { login: 'reviewer', id: 901 },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'reviewer', id: 901 },
        },
      });

      expect(result.ignoredReason).toBeNull();
      expect(result.notificationEvents).toHaveLength(1);
      expect(result.notificationEvents[0]?.type).toBe('pr_comment');
      expect(result.notificationEvents[0]?.externalUrl).toBe(
        'https://github.com/acme/web/pull/7#issuecomment-1',
      );
      expect(result.notificationEvents[0]?.entityId).toBe(result.pullRequests[0]?.id);

      const edited = await applyGithubEvent(tx, {
        eventName: 'issue_comment',
        body: {
          action: 'edited',
          issue: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/7' },
          },
          comment: {
            body: 'Updated wording.',
            html_url: 'https://github.com/acme/web/pull/7#issuecomment-1',
            user: { login: 'reviewer', id: 901 },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'reviewer', id: 901 },
        },
      });
      expect(edited.notificationEvents).toEqual([]);
    });
  });

  it('plans one canonical pull request notification across several linked issues', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const stateId = fixture.states['Backlog'];
      if (stateId === undefined) throw new Error('the backlog state is missing');
      await tx.insert(issue).values({
        id: `iss_${randomUUIDv7()}`,
        organizationId: fixture.organizationId,
        teamId: fixture.teamId,
        number: 4,
        identifier: 'ENG-4',
        title: 'Related dashboard work',
        stateId,
        creatorId: fixture.creatorId,
        assigneeId: fixture.assigneeId,
      });

      const result = await applyGithubEvent(
        tx,
        prEvent({
          action: 'closed',
          state: 'closed',
          headRef: 'chore/no-identifier',
          body: 'Fixes ENG-3\nFixes ENG-4',
        }),
      );

      expect(result.notificationEvents).toHaveLength(1);
      expect(result.notificationEvents[0]?.userIds).toEqual([
        fixture.creatorId,
        fixture.assigneeId,
      ]);
      expect(result.notificationEvents[0]?.entityType).toBe('github_pull_request');
      expect(result.notificationEvents[0]?.entityId).toBe(result.pullRequests[0]?.id);
      expect(result.notificationEvents[0]).toMatchObject({
        source: {
          sourceEventKey: 'github:99:pr:7:pull_request:7007:closed:2026-08-13T02:00:00.000Z',
          subjectType: 'github_pull_request',
          subjectKey: 'github-pr:99:7',
        },
      });
    });
  });

  it('stores and notifies the author about a comment on an unlinked pull request', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const opened = prEvent({
        headRef: 'chore/unlinked',
        title: 'Unlinked work',
        body: 'No Orbit identifier.',
      });
      const openedBody = opened.body as {
        pull_request: { number: number; html_url: string; head: { ref: string } };
      };
      openedBody.pull_request.number = 88;
      openedBody.pull_request.html_url = 'https://github.com/acme/web/pull/88';
      openedBody.pull_request.head.ref = 'chore/unlinked';
      await applyGithubEvent(tx, opened);
      const result = await applyGithubEvent(tx, {
        eventName: 'issue_comment',
        body: {
          action: 'created',
          issue: {
            number: 88,
            title: 'Unlinked work',
            html_url: 'https://github.com/acme/web/pull/88',
            pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/88' },
          },
          comment: {
            body: 'Maybe this is related to ENG-3.',
            html_url: 'https://github.com/acme/web/pull/88#issuecomment-2',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'reviewer', id: 901 },
        },
      });

      expect(result.ignoredReason).toBeNull();
      expect(result.notificationEvents).toHaveLength(1);
      expect(result.notificationEvents[0]?.entityType).toBe('github_pull_request');
      expect(result.notificationEvents[0]?.userIds).toEqual([fixture.creatorId]);
      expect(result.notificationEvents[0]?.url).toMatch(/^\/pulls\//);
      expect(
        await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId)),
      ).toHaveLength(0);
      const pulls = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pulls).toHaveLength(1);
      const activities = await tx
        .select()
        .from(githubPullRequestActivity)
        .where(eq(githubPullRequestActivity.pullRequestId, pulls[0]?.id ?? 'missing'));
      expect(activities).toHaveLength(2);
      const comment = activities.find((activity) => activity.type === 'comment');
      expect(comment?.body).toBe('Maybe this is related to ENG-3.');
    });
  });

  it('notifies a mapped workspace reviewer about an unlinked pull request', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const requested = prEvent({
        action: 'review_requested',
        headRef: 'chore/unlinked',
        title: 'Unlinked work',
        body: 'No Orbit identifier.',
      });
      const requestedBody = requested.body as Record<string, unknown>;
      requestedBody['requested_reviewer'] = { login: 'assignee', id: 900 };

      const result = await applyGithubEvent(tx, requested);

      expect(result.notificationEvents).toHaveLength(1);
      expect(result.notificationEvents[0]?.type).toBe('pr_review_requested');
      expect(result.notificationEvents[0]?.userIds).toEqual([fixture.assigneeId]);
      expect(result.notificationEvents[0]?.entityId).toBe(result.pullRequests[0]?.id);
    });
  });

  it('keeps each unlinked pull request notification scoped to its author', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(
        tx,
        prEvent({
          title: 'First unrelated change',
          headRef: 'chore/first-unrelated',
          headSha: SHARED_HEAD_SHA,
          body: 'No Orbit identifier.',
        }),
      );
      await applyGithubEvent(
        tx,
        prEvent({
          number: 8,
          externalId: 8008,
          title: 'Second unrelated change',
          headRef: 'chore/second-unrelated',
          headSha: SHARED_HEAD_SHA,
          body: 'No Orbit identifier.',
          author: { login: 'assignee', id: 900 },
        }),
      );

      const result = await applyCheckEvent(
        tx,
        fixture.organizationId,
        checkRunEvent({
          id: 404,
          name: 'verify',
          conclusion: 'failure',
          headSha: SHARED_HEAD_SHA,
          pullRequestNumbers: [7, 8],
          completedAt: '2026-08-13T06:00:00.000Z',
        }),
      );

      expect(result.notificationEvents).toHaveLength(2);
      const first = result.notificationEvents.find(
        (event) => event.source?.subjectKey === 'github-pr:99:7',
      );
      const second = result.notificationEvents.find(
        (event) => event.source?.subjectKey === 'github-pr:99:8',
      );
      expect(first?.userIds).toEqual([fixture.creatorId]);
      expect(second?.userIds).toEqual([fixture.assigneeId]);
    });
  });

  it('does not notify a mapped GitHub user after they leave the workspace', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx.delete(member).where(eq(member.userId, fixture.creatorId));
      const result = await applyGithubEvent(
        tx,
        prEvent({
          action: 'closed',
          merged: true,
          state: 'closed',
          headRef: 'chore/unlinked',
          title: 'Unlinked work',
          body: 'No Orbit identifier.',
        }),
      );

      expect(result.notificationEvents).toHaveLength(0);
    });
  });

  it('rechecks team access after a concurrent membership removal', async () => {
    const fixture = await db.transaction(async (tx) => {
      const seeded = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      return seeded;
    });
    const webhookDeliveryId = `whd_${randomUUIDv7()}`;
    await db.insert(webhookDelivery).values({
      id: webhookDeliveryId,
      provider: 'github',
      deliveryId: `delivery_${randomUUIDv7()}`,
      event: 'check_run',
      organizationId: fixture.organizationId,
      status: 'processing',
    });
    let announceRemoval = (): void => undefined;
    const removalReady = new Promise<void>((resolve) => {
      announceRemoval = resolve;
    });
    let releaseRemoval = (): void => undefined;
    const removalRelease = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    const removal = db.transaction(async (tx) => {
      await tx
        .delete(teamMember)
        .where(
          and(eq(teamMember.teamId, fixture.teamId), eq(teamMember.userId, fixture.assigneeId)),
        );
      announceRemoval();
      await removalRelease;
    });

    try {
      await removalReady;
      const applying = applyGithubEvent(db, {
        ...checkRunEvent({
          id: 505,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T06:00:00.000Z',
        }),
        organizationId: fixture.organizationId,
        webhookDeliveryId,
      });
      const releaseTimer = setTimeout(releaseRemoval, 50);
      const result = await applying;
      clearTimeout(releaseTimer);
      releaseRemoval();
      await removal;

      expect(result.notificationEvents).toHaveLength(1);
      expect(result.notificationEvents[0]?.userIds).toEqual([fixture.creatorId]);
    } finally {
      releaseRemoval();
      await removal.catch(() => undefined);
      await db.delete(organization).where(eq(organization.id, fixture.organizationId));
      await db.delete(user).where(eq(user.id, fixture.creatorId));
      await db.delete(user).where(eq(user.id, fixture.assigneeId));
    }
  });

  it('backfills review, comment, and check history idempotently', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const applied = await applyGithubEvent(tx, prEvent({}));
      const pullRequestId = applied.pullRequests[0]?.id;
      if (pullRequestId === undefined) throw new Error('the mirrored pull request is missing');
      const entries = [
        {
          externalId: 'comment:11',
          type: 'comment' as const,
          actor: { login: 'ada', id: 1 },
          body: 'Please add a regression test.',
          url: 'https://github.com/acme/web/pull/7#issuecomment-11',
          state: 'created',
          path: null,
          line: null,
          occurredAt: '2026-08-13T01:00:00.000Z',
        },
        {
          externalId: 'review:12',
          type: 'review' as const,
          actor: { login: 'grace', id: 2 },
          body: 'Approved.',
          url: 'https://github.com/acme/web/pull/7#pullrequestreview-12',
          state: 'approved',
          path: null,
          line: null,
          occurredAt: '2026-08-13T02:00:00.000Z',
        },
        {
          externalId: 'check_run:13:completed:failure',
          type: 'checks' as const,
          actor: { login: 'github-actions', id: 0 },
          body: 'verify',
          url: 'https://github.com/acme/web/actions/runs/13',
          state: 'failure',
          path: null,
          line: null,
          occurredAt: '2026-08-13T03:00:00.000Z',
        },
        {
          externalId: 'check_run:14:completed:success',
          type: 'checks' as const,
          actor: { login: 'github-actions', id: 0 },
          body: 'verify',
          url: 'https://github.com/acme/web/actions/runs/14',
          state: 'success',
          path: null,
          line: null,
          occurredAt: '2026-08-13T04:00:00.000Z',
        },
      ];

      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries,
      });
      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries,
      });

      const activities = await tx
        .select()
        .from(githubPullRequestActivity)
        .where(eq(githubPullRequestActivity.pullRequestId, pullRequestId));
      expect(activities).toHaveLength(5);
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, pullRequestId));
      expect(pull?.state).toBe('approved');
      expect(pull?.checkStatus).toBe('success');
      expect(pull?.historySyncedAt).not.toBeNull();
    });
  });

  it('clears an approved decision when GitHub reports the review was dismissed', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const applied = await applyGithubEvent(tx, prEvent({}));
      const pullRequestId = applied.pullRequests[0]?.id;
      if (pullRequestId === undefined) throw new Error('the mirrored pull request is missing');

      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries: [
          {
            externalId: 'review:21',
            type: 'review',
            actor: { login: 'grace', id: 2 },
            body: 'Approved.',
            url: 'https://github.com/acme/web/pull/7#pullrequestreview-21',
            state: 'approved',
            path: null,
            line: null,
            occurredAt: '2026-08-13T03:00:00.000Z',
          },
        ],
      });
      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries: [
          {
            externalId: 'review:22',
            type: 'review',
            actor: { login: 'grace', id: 2 },
            body: 'No longer applies.',
            url: 'https://github.com/acme/web/pull/7#pullrequestreview-22',
            state: 'dismissed',
            path: null,
            line: null,
            occurredAt: '2026-08-13T04:00:00.000Z',
          },
        ],
      });

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, pullRequestId));
      expect(pull?.reviewDecision).toBeNull();
      expect(pull?.state).toBe('open');
    });
  });

  it('keeps an outstanding change request after another reviewer approves', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const applied = await applyGithubEvent(tx, prEvent({}));
      const pullRequestId = applied.pullRequests[0]?.id;
      if (pullRequestId === undefined) throw new Error('the mirrored pull request is missing');

      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries: [
          {
            externalId: 'review:31',
            type: 'review',
            actor: { login: 'grace', id: 2 },
            body: 'Please fix this.',
            url: 'https://github.com/acme/web/pull/7#pullrequestreview-31',
            state: 'changes_requested',
            path: null,
            line: null,
            occurredAt: '2026-08-13T03:00:00.000Z',
          },
          {
            externalId: 'review:32',
            type: 'review',
            actor: { login: 'ada', id: 1 },
            body: 'Approved.',
            url: 'https://github.com/acme/web/pull/7#pullrequestreview-32',
            state: 'approved',
            path: null,
            line: null,
            occurredAt: '2026-08-13T04:00:00.000Z',
          },
        ],
      });

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, pullRequestId));
      expect(pull?.reviewDecision).toBe('changes_requested');
      expect(pull?.state).toBe('changes_requested');
    });
  });

  it('keeps persisted review and check rollups when a later history page omits them', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const applied = await applyGithubEvent(tx, prEvent({}));
      const pullRequestId = applied.pullRequests[0]?.id;
      if (pullRequestId === undefined) throw new Error('the mirrored pull request is missing');

      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries: [
          {
            externalId: 'review:41',
            type: 'review',
            actor: { login: 'grace', id: 2 },
            body: 'Please fix this.',
            url: 'https://github.com/acme/web/pull/7#pullrequestreview-41',
            state: 'changes_requested',
            path: null,
            line: null,
            occurredAt: '2026-08-13T03:00:00.000Z',
          },
          {
            externalId: 'check_run:41:completed:failure',
            type: 'checks',
            actor: { login: 'github-actions', id: 0 },
            body: 'verify',
            url: 'https://github.com/acme/web/actions/runs/41',
            state: 'failure',
            path: null,
            line: null,
            occurredAt: '2026-08-13T03:00:00.000Z',
          },
        ],
      });
      await upsertGithubPullRequestHistory(tx, {
        organizationId: fixture.organizationId,
        pullRequestId,
        entries: [
          {
            externalId: 'review:42',
            type: 'review',
            actor: { login: 'ada', id: 1 },
            body: 'Approved.',
            url: 'https://github.com/acme/web/pull/7#pullrequestreview-42',
            state: 'approved',
            path: null,
            line: null,
            occurredAt: '2026-08-13T04:00:00.000Z',
          },
          {
            externalId: 'check_run:42:completed:success',
            type: 'checks',
            actor: { login: 'github-actions', id: 0 },
            body: 'lint',
            url: 'https://github.com/acme/web/actions/runs/42',
            state: 'success',
            path: null,
            line: null,
            occurredAt: '2026-08-13T04:00:00.000Z',
          },
        ],
      });

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.id, pullRequestId));
      expect(pull?.reviewDecision).toBe('changes_requested');
      expect(pull?.checkStatus).toBe('failure');
    });
  });

  it('records a late review event without letting it replace a newer decision', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      await applyGithubEvent(tx, prEvent({}));

      const reviewEvent = (input: {
        readonly id: number;
        readonly state: string;
        readonly submittedAt: string;
      }) => ({
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: {
            id: input.id,
            state: input.state,
            submitted_at: input.submittedAt,
            user: { login: 'rev', id: 900 },
          },
          pull_request: {
            id: 7007,
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            head: { ref: 'eng-3-dashboard', sha: HEAD_SHA },
            base: { ref: 'main' },
            updated_at: input.submittedAt,
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });

      await applyGithubEvent(
        tx,
        reviewEvent({ id: 31, state: 'approved', submittedAt: '2026-08-13T04:00:00.000Z' }),
      );
      await applyGithubEvent(
        tx,
        reviewEvent({
          id: 30,
          state: 'changes_requested',
          submittedAt: '2026-08-13T03:00:00.000Z',
        }),
      );

      const [pull] = await tx.select().from(githubPullRequest);
      expect(pull?.reviewDecision).toBe('approved');
      expect(pull?.state).toBe('approved');
      const activities = await tx.select().from(githubPullRequestActivity);
      expect(activities.filter((activity) => activity.type === 'review')).toHaveLength(2);
    });
  });

  it('does not let newer review activity regress an older pull request snapshot', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(
        tx,
        prEvent({ headSha: NEXT_HEAD_SHA, updatedAt: '2026-08-13T06:00:00.000Z' }),
      );

      await applyGithubEvent(tx, {
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: {
            id: 908,
            state: 'approved',
            body: 'Looks good',
            html_url: 'https://github.com/acme/web/pull/7#pullrequestreview-908',
            user: { login: 'rev', id: 900 },
            submitted_at: '2026-08-13T07:00:00.000Z',
          },
          pull_request: {
            id: 7007,
            number: 7,
            title: 'Stale pull snapshot',
            body: 'Fixes ENG-3',
            html_url: 'https://github.com/acme/web/pull/7',
            draft: false,
            merged: false,
            state: 'open',
            head: { ref: 'eng-3-old', sha: HEAD_SHA },
            base: { ref: 'main' },
            user: { login: 'octocat', id: 500 },
            created_at: '2026-08-13T01:00:00.000Z',
            updated_at: '2026-08-13T05:00:00.000Z',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });

      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.headSha).toBe(NEXT_HEAD_SHA);
      expect(pull?.providerUpdatedAt?.toISOString()).toBe('2026-08-13T06:00:00.000Z');
      expect(pull?.reviewDecision).toBe('approved');
      expect(pull?.headEpoch).toBe(0);
    });
  });

  it('owns every candidate head before queuing an equal-time pull conflict', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const providerTime = '2026-08-13T06:00:00.000Z';
      await applyGithubEvent(tx, prEvent({ headSha: HEAD_SHA, updatedAt: providerTime }));

      await applyGithubEvent(
        tx,
        prEvent({ action: 'synchronize', headSha: NEXT_HEAD_SHA, updatedAt: providerTime }),
      );

      const heads = await tx
        .select()
        .from(githubCheckHeadReconciliation)
        .where(eq(githubCheckHeadReconciliation.organizationId, fixture.organizationId));
      expect(heads.map((head) => head.headSha).sort()).toEqual([HEAD_SHA, NEXT_HEAD_SHA].sort());
      const [pull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(pull?.headSha).toBe(HEAD_SHA);
      const [conflict] = await tx
        .select()
        .from(githubPullRequestReconciliation)
        .where(eq(githubPullRequestReconciliation.pullRequestId, pull?.id ?? 'missing'));
      expect(conflict?.status).toBe('pending');
      expect(conflict?.conflictingHeadShas).toEqual([HEAD_SHA, NEXT_HEAD_SHA].sort());
    });
  });

  it('does not let a late review reopen a merged link or notify again', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await applyGithubEvent(tx, {
        eventName: 'pull_request',
        body: {
          action: 'closed',
          pull_request: {
            id: 7007,
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            draft: false,
            merged: true,
            state: 'closed',
            head: { ref: 'eng-3-dashboard', sha: HEAD_SHA },
            base: { ref: 'main' },
            user: { login: 'octocat', id: 500 },
            updated_at: '2026-08-13T05:00:00.000Z',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'octocat', id: 500 },
        },
      });

      const late = await applyGithubEvent(tx, {
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: {
            id: 30,
            state: 'changes_requested',
            submitted_at: '2026-08-13T03:00:00.000Z',
            user: { login: 'rev', id: 900 },
          },
          pull_request: {
            id: 7007,
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/legacy/pull/7',
            draft: false,
            merged: false,
            state: 'open',
            head: { ref: 'eng-3-dashboard', sha: HEAD_SHA },
            base: { ref: 'main' },
            user: { login: 'octocat', id: 500 },
            updated_at: '2026-08-13T03:00:00.000Z',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });

      const [link] = await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId));
      expect(link?.state).toBe('merged');
      expect(link?.url).toBe('https://github.com/acme/web/pull/7');
      expect(late.notificationEvents).toHaveLength(0);
    });
  });

  it('does not let a newer abbreviated comment snapshot reopen a merged pull request', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
      await applyGithubEvent(tx, {
        eventName: 'pull_request',
        body: {
          action: 'closed',
          pull_request: {
            id: 7007,
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            merged: true,
            state: 'closed',
            head: { ref: 'eng-3-dashboard', sha: HEAD_SHA },
            base: { ref: 'main' },
            updated_at: '2026-08-13T05:00:00.000Z',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'octocat', id: 500 },
        },
      });

      await applyGithubEvent(tx, {
        eventName: 'issue_comment',
        body: {
          action: 'created',
          issue: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            pull_request: { url: 'https://api.github.com/repos/acme/web/pulls/7' },
          },
          comment: {
            id: 91,
            body: 'Merged cleanly.',
            html_url: 'https://github.com/acme/web/pull/7#issuecomment-91',
            created_at: '2026-08-13T06:00:00.000Z',
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'reviewer', id: 901 },
        },
      });

      const [pull] = await tx.select().from(githubPullRequest);
      expect(pull?.state).toBe('merged');
      expect(pull?.merged).toBe(true);
      expect(pull?.headSha).toBe(HEAD_SHA);
    });
  });

  it('excludes a former team member from notifications and realtime user scopes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'In Progress');
      await tx.delete(teamMember).where(eq(teamMember.userId, fixture.assigneeId));

      const result = await applyGithubEvent(tx, {
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: { state: 'approved', user: { login: 'rev', id: 900 } },
          pull_request: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            head: { ref: 'eng-3-dashboard' },
            base: { ref: 'main' },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });

      expect(result.notificationEvents[0]?.userIds).toContain(fixture.creatorId);
      expect(result.notificationEvents[0]?.userIds).not.toContain(fixture.assigneeId);
      const linkAction = result.actions.find((action) => action.model === 'git_link');
      expect(linkAction?.scopes).not.toContain(`user:${fixture.assigneeId}`);
    });
  });

  it('keeps a workspace administrator in the audience without a team membership', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx, 'In Progress');
      await tx.delete(teamMember).where(eq(teamMember.userId, fixture.assigneeId));
      await tx.update(member).set({ role: 'admin' }).where(eq(member.userId, fixture.assigneeId));

      const result = await applyGithubEvent(tx, {
        eventName: 'pull_request_review',
        body: {
          action: 'submitted',
          review: { state: 'approved', user: { login: 'rev', id: 900 } },
          pull_request: {
            number: 7,
            title: 'Rework dashboard',
            html_url: 'https://github.com/acme/web/pull/7',
            head: { ref: 'eng-3-dashboard' },
            base: { ref: 'main' },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'rev', id: 900 },
        },
      });

      expect(result.notificationEvents[0]?.userIds).toContain(fixture.assigneeId);
    });
  });
});

describe('saying why a delivery changed nothing', () => {
  it('names an unconnected repository, which is what a fresh install looks like', async () => {
    await withRollback(async (tx) => {
      const result = await applyGithubEvent(tx, {
        eventName: 'pull_request',
        body: {
          action: 'opened',
          pull_request: {
            number: 1,
            title: 'x',
            html_url: 'https://x',
            head: { ref: 'eng-3' },
            base: { ref: 'main' },
          },
          repository: { id: 12345, full_name: 'nobody/repo' },
          sender: { login: 'x', id: 1 },
        },
      });

      expect(result.ignoredReason).toBe('repository_not_connected');
    });
  });

  it('names an event the parser does not cover', async () => {
    await withRollback(async (tx) => {
      const result = await applyGithubEvent(tx, { eventName: 'star', body: {} });

      expect(result.ignoredReason).toBe('unsupported_event');
    });
  });

  it('processes a pull request that names no issue because the mirror is independent', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      const result = await applyGithubEvent(
        tx,
        prEvent({ headRef: 'chore/tidy-up', title: 'Tidy up' }),
      );

      expect(result.handled).toBe(true);
      expect(result.ignoredReason).toBeNull();
      expect(result.pullRequests).toHaveLength(1);
    });
  });

  it('reports nothing ignored when the event actually lands', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      const result = await applyGithubEvent(tx, prEvent({}));

      expect(result.handled).toBe(true);
      expect(result.ignoredReason).toBeNull();
    });
  });
});
