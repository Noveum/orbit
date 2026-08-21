import { describe, expect, it } from 'bun:test';
import {
  account,
  githubPullRequest,
  githubPullRequestActivity,
  githubRepositorySync,
  gitLink,
  integration,
  issue,
  issueReviewer,
  member,
  organization,
  team,
  teamMember,
  user,
  workflowState,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq } from 'drizzle-orm';
import { applyGithubEvent, upsertGithubPullRequestHistory } from '../../src/github/apply.ts';
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
  body?: string;
}): { eventName: string; body: unknown } {
  return {
    eventName: 'pull_request',
    body: {
      action: overrides.action ?? 'opened',
      pull_request: {
        id: 7007,
        number: 7,
        title: overrides.title ?? 'Rework dashboard',
        body: overrides.body ?? null,
        html_url: 'https://github.com/acme/web/pull/7',
        draft: overrides.draft ?? false,
        merged: overrides.merged ?? false,
        state: overrides.state ?? 'open',
        head: { ref: overrides.headRef ?? 'eng-3-dashboard', sha: 'abc123' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
        created_at: '2026-08-13T01:00:00.000Z',
        updated_at: '2026-08-13T02:00:00.000Z',
      },
      repository: { id: 99, full_name: 'acme/web' },
      sender: { login: 'octocat', id: 500 },
    },
  };
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

  it('notifies a review request and a failed check suite', async () => {
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
            head: { ref: 'eng-3-dashboard' },
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

      const checks = await applyGithubEvent(tx, {
        eventName: 'check_suite',
        body: {
          action: 'completed',
          check_suite: {
            conclusion: 'error',
            head_branch: 'eng-3-dashboard',
            pull_requests: [{ number: 7 }],
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'ci', id: 3 },
        },
      });
      expect(checks.notificationEvents.some((event) => event.type === 'pr_checks_failed')).toBe(
        true,
      );
      const [failedPull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(failedPull?.checkStatus).toBe('failure');

      await applyGithubEvent(tx, {
        eventName: 'check_run',
        body: {
          action: 'completed',
          check_run: {
            id: 81,
            name: 'verify',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/web/actions/runs/81',
            head_sha: '',
            pull_requests: [{ number: 7 }],
            check_suite: { head_branch: 'eng-3-dashboard' },
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'ci', id: 3 },
        },
      });
      const [passingPull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(passingPull?.checkStatus).toBe('failure');

      await applyGithubEvent(tx, {
        eventName: 'check_suite',
        body: {
          action: 'completed',
          check_suite: {
            conclusion: 'success',
            head_branch: 'eng-3-dashboard',
            pull_requests: [{ number: 7 }],
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'ci', id: 3 },
        },
      });
      const [recoveredPull] = await tx
        .select()
        .from(githubPullRequest)
        .where(eq(githubPullRequest.organizationId, fixture.organizationId));
      expect(recoveredPull?.checkStatus).toBe('success');
      expect(await currentStateName(tx, fixture.issueId)).toBe('In Review');
    });
  });

  it('rolls up concurrent checks and ignores an older retry result', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await applyGithubEvent(tx, prEvent({}));
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
            status: 'completed',
            conclusion: input.conclusion,
            html_url: `https://github.com/acme/web/actions/runs/${input.id}`,
            head_sha: 'abc123',
            pull_requests: [{ number: 7 }],
            check_suite: { head_branch: 'eng-3-dashboard' },
            completed_at: input.completedAt,
          },
          repository: { id: 99, full_name: 'acme/web' },
          sender: { login: 'ci', id: 3 },
        },
      });

      await applyGithubEvent(
        tx,
        checkRun({
          id: 81,
          name: 'verify',
          conclusion: 'failure',
          completedAt: '2026-08-13T05:00:00.000Z',
        }),
      );
      await applyGithubEvent(
        tx,
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

      await applyGithubEvent(
        tx,
        checkRun({
          id: 81,
          name: 'verify',
          conclusion: 'success',
          completedAt: '2026-08-13T07:00:00.000Z',
        }),
      );
      await applyGithubEvent(
        tx,
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
      const fixture = await seed(tx);
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
      expect(result.notificationEvents[0]?.entityId).toBe(fixture.issueId);

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
            head: { ref: 'eng-3-dashboard', sha: 'abc123' },
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
            head: { ref: 'eng-3-dashboard', sha: 'abc123' },
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
            head: { ref: 'eng-3-dashboard', sha: 'abc123' },
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
            head: { ref: 'eng-3-dashboard', sha: 'abc123' },
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
      expect(pull?.headSha).toBe('abc123');
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
