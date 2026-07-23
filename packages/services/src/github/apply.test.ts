import { describe, expect, it } from 'bun:test';
import {
  githubRepositorySync,
  gitLink,
  integration,
  issue,
  organization,
  team,
  user,
  workflowState,
} from '@orbit/db/schema';
import { randomUUIDv7 } from 'bun';
import { eq } from 'drizzle-orm';
import { type TestTransaction, withRollback } from '../test-database.ts';
import { applyGithubEvent } from './apply.ts';

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

  const teamId = `team_${suffix}`;
  await tx.insert(team).values({ id: teamId, organizationId, name: 'Engineering', key: 'ENG' });

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

  const creatorId = `usr_creator_${suffix}`;
  const assigneeId = `usr_assignee_${suffix}`;
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
}): { eventName: string; body: unknown } {
  return {
    eventName: 'pull_request',
    body: {
      action: overrides.action ?? 'opened',
      pull_request: {
        number: 7,
        title: overrides.title ?? 'Rework dashboard',
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
});
