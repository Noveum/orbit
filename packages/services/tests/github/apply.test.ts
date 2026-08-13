import { describe, expect, it } from 'bun:test';
import {
  githubRepositorySync,
  gitLink,
  integration,
  issue,
  member,
  organization,
  team,
  teamMember,
  user,
  workflowState,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq } from 'drizzle-orm';
import { applyGithubEvent } from '../../src/github/apply.ts';
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
        number: 7,
        title: overrides.title ?? 'Rework dashboard',
        body: overrides.body ?? null,
        html_url: 'https://github.com/acme/web/pull/7',
        draft: overrides.draft ?? false,
        merged: overrides.merged ?? false,
        state: overrides.state ?? 'open',
        head: { ref: overrides.headRef ?? 'eng-3-dashboard' },
        base: { ref: 'main' },
        user: { login: 'octocat', id: 500 },
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

  it('still links nothing when no identifier appears anywhere, description included', async () => {
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
      expect(result.actions.some((action) => action.model === 'issue')).toBe(true);
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
            conclusion: 'failure',
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
      expect(await currentStateName(tx, fixture.issueId)).toBe('In Review');
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
    });
  });

  it('does not link an unlinked pull request from an identifier in a comment', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
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

      expect(result.ignoredReason).toBe('no_matching_issue');
      expect(result.notificationEvents).toHaveLength(0);
      expect(
        await tx.select().from(gitLink).where(eq(gitLink.issueId, fixture.issueId)),
      ).toHaveLength(0);
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

  it('names a branch that mentions no issue, so the delivery is not mistaken for a failure', async () => {
    await withRollback(async (tx) => {
      await seed(tx);
      const result = await applyGithubEvent(
        tx,
        prEvent({ headRef: 'chore/tidy-up', title: 'Tidy up' }),
      );

      expect(result.handled).toBe(true);
      expect(result.ignoredReason).toBe('no_issue_identifier');
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
