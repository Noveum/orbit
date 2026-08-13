import { beforeEach, describe, expect, it } from 'bun:test';
import type { Database, Transaction } from '@orbit/db';
import { and, asc, db, eq, inArray, schema, sql } from '@orbit/db';
import * as databaseSchema from '@orbit/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  bootstrapActiveCycleMemberships,
  bootstrapCycleMemberships,
} from '../../src/analytics/membership.ts';
import { insertIssue } from '../../src/analytics/test-fixtures.ts';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import { completeCycle, createCycle, listCycles } from '../../src/work/cycle-service.ts';
import {
  archiveIssue,
  bulkUpdateIssues,
  createIssue,
  deleteIssue,
  moveIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';
import { createMilestone } from '../../src/work/milestone-service.ts';
import { createProject } from '../../src/work/project-service.ts';

let workspace: Workspace;
let activeDatabaseUrl = '';

beforeEach(async () => {
  await resetDatabase();
  const [database] = await db.execute(sql<{ name: string }>`select current_database() as name`);
  if (database === undefined) throw new Error('The test database could not be resolved.');
  const configured = process.env['DATABASE_URL'];
  if (configured === undefined || configured.length === 0)
    throw new Error('DATABASE_URL is required.');
  const resolved = new URL(configured);
  resolved.pathname = `/${database['name']}`;
  activeDatabaseUrl = resolved.toString();
  workspace = await createWorkspace('Nova');
});

async function firstCycle() {
  const [cycle] = await listCycles(workspace.admin);
  if (cycle === undefined) throw new Error('missing bootstrap cycle');
  return cycle;
}

function errorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof cursor !== 'object' || cursor === null) break;
    if ('message' in cursor && typeof cursor.message === 'string') messages.push(cursor.message);
    cursor = 'cause' in cursor ? cursor.cause : undefined;
  }
  return messages;
}

async function openMemberships(issueId: string) {
  const memberships = await db
    .select()
    .from(schema.cycleIssueMembership)
    .where(eq(schema.cycleIssueMembership.issueId, issueId));
  return memberships.filter((entry) => entry.removedAt === null);
}

interface RunningOperation<T> {
  readonly result: Promise<T>;
  readonly settled: () => boolean;
}

function databaseUrl(): string {
  if (activeDatabaseUrl.length === 0) throw new Error('The active test database is unresolved.');
  return activeDatabaseUrl;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitingLockCount(executor: Transaction): Promise<number> {
  const [row] = await executor.execute(sql<{ waiting: number }>`
    select count(*)::int as waiting
    from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
      and wait_event_type = 'Lock'
  `);
  return Number(row?.['waiting'] ?? 0);
}

async function waitForLockCount(
  executor: Transaction,
  count: number,
  workers: readonly RunningOperation<unknown>[] = [],
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await waitingLockCount(executor)) >= count) return;
    const settled = workers.find((worker) => worker.settled());
    if (settled !== undefined) {
      await settled.result;
      throw new Error('A worker settled before reaching the expected database lock.');
    }
    await pause(10);
  }
  const activity = await executor.execute(sql<{
    applicationName: string;
    databaseName: string | null;
    state: string | null;
    waitEventType: string | null;
  }>`
    select application_name as "applicationName", datname as "databaseName", state,
      wait_event_type as "waitEventType"
    from pg_stat_activity
    where pid <> pg_backend_pid()
      and backend_type = 'client backend'
  `);
  throw new Error(`Expected ${count} database lock waiters: ${JSON.stringify(activity)}.`);
}

async function waitForWorkerOrLock(
  executor: Transaction,
  worker: RunningOperation<unknown>,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (worker.settled() || (await waitingLockCount(executor)) >= count) return;
    await pause(10);
  }
  throw new Error('The competing worker neither settled nor waited for a database lock.');
}

async function withHeldAdvisoryLock<T>(
  key: number,
  run: (executor: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
    return await run(tx);
  });
}

function trackOperation<T>(result: Promise<T>): RunningOperation<T> {
  let isSettled = false;
  return {
    result: result.finally(() => {
      isSettled = true;
    }),
    settled: () => isSettled,
  };
}

function createIsolatedDatabase(): {
  readonly database: Database;
  readonly connect: () => Promise<void>;
  readonly close: () => Promise<void>;
} {
  const client = postgres(databaseUrl(), { max: 1, idle_timeout: 5, onnotice: () => undefined });
  return {
    database: drizzle({ client, schema: databaseSchema, casing: 'snake_case' }),
    connect: async () => {
      await client`select 1`;
    },
    close: async () => client.end(),
  };
}

describe('sprint membership capture', () => {
  it('records create, move, and rollover membership in mutation transactions', async () => {
    const first = await firstCycle();
    const { cycle: second } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: first.endsAt,
      endsAt: new Date(first.endsAt.getTime() + 14 * 86_400_000),
    });
    const { cycle: third } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: second.endsAt,
      endsAt: new Date(second.endsAt.getTime() + 14 * 86_400_000),
    });

    const created = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Move with the sprint',
      cycleId: first.id,
      estimate: 3,
      stateId: stateNamed(workspace, 'Todo').id,
    });
    await updateIssue(workspace.admin, created.issue.id, { cycleId: second.id });
    await completeCycle(workspace.admin, second.id, second.endsAt);

    const memberships = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.issueId, created.issue.id))
      .orderBy(asc(schema.cycleIssueMembership.addedAt));

    expect(memberships.map((entry) => entry.cycleId)).toEqual([first.id, second.id, third.id]);
    expect(memberships[0]?.removedAt).not.toBeNull();
    expect(memberships[1]?.removedAt?.getTime()).toBe(second.endsAt.getTime());
    expect(memberships[2]?.entryKind).toBe('rollover');
    expect(memberships[2]?.estimateAtAdd).toBe(3);
  });

  it('captures regrouped moves and bulk sprint updates', async () => {
    const first = await firstCycle();
    const { cycle: second } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: first.endsAt,
      endsAt: new Date(first.endsAt.getTime() + 14 * 86_400_000),
    });
    const { cycle: third } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: second.endsAt,
      endsAt: new Date(second.endsAt.getTime() + 14 * 86_400_000),
    });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Every mutation path',
      cycleId: first.id,
    });

    await moveIssue(workspace.admin, issue.id, { cycleId: second.id });
    await bulkUpdateIssues(workspace.admin, {
      issueIds: [issue.id],
      patch: { cycleId: third.id },
    });

    const memberships = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.issueId, issue.id))
      .orderBy(asc(schema.cycleIssueMembership.addedAt));
    expect(memberships.map((entry) => entry.cycleId)).toEqual([first.id, second.id, third.id]);
    expect(await openMemberships(issue.id)).toHaveLength(1);
    expect((await openMemberships(issue.id))[0]?.cycleId).toBe(third.id);
  });

  it('serializes concurrent moves so one issue has one open sprint', async () => {
    const first = await firstCycle();
    const { cycle: second } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: first.endsAt,
      endsAt: new Date(first.endsAt.getTime() + 14 * 86_400_000),
    });
    const { cycle: third } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: second.endsAt,
      endsAt: new Date(second.endsAt.getTime() + 14 * 86_400_000),
    });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Concurrent move',
      cycleId: first.id,
    });
    await db.execute(
      sql.raw(`
      drop trigger if exists delay_cycle_assignment on issue;
      drop function if exists delay_cycle_assignment();
      create function delay_cycle_assignment() returns trigger as $$
      begin
        perform pg_advisory_xact_lock(731107);
        return new;
      end;
      $$ language plpgsql;
      create trigger delay_cycle_assignment
      before update on issue
      for each row execute function delay_cycle_assignment();
    `),
    );

    const firstConnection = createIsolatedDatabase();
    const secondConnection = createIsolatedDatabase();
    const moves: RunningOperation<unknown>[] = [];
    try {
      await Promise.all([firstConnection.connect(), secondConnection.connect()]);
      await withHeldAdvisoryLock(731107, async (holder) => {
        const firstMove = trackOperation(
          updateIssue(workspace.admin, issue.id, { cycleId: second.id }, firstConnection.database),
        );
        moves.push(firstMove);
        await waitForLockCount(holder, 1, [firstMove]);
        const secondMove = trackOperation(
          updateIssue(workspace.admin, issue.id, { cycleId: third.id }, secondConnection.database),
        );
        moves.push(secondMove);
        await waitForLockCount(holder, 2, [firstMove, secondMove]);
      });
      await Promise.all(moves.map((worker) => worker.result));
    } finally {
      await Promise.allSettled(moves.map((worker) => worker.result));
      await Promise.all([firstConnection.close(), secondConnection.close()]);
      await db.execute(
        sql.raw(`
        drop trigger delay_cycle_assignment on issue;
        drop function delay_cycle_assignment();
      `),
      );
    }

    expect(await openMemberships(issue.id)).toHaveLength(1);
  });

  it('serializes rollover against a concurrent move', async () => {
    const first = await firstCycle();
    const { cycle: second } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: first.endsAt,
      endsAt: new Date(first.endsAt.getTime() + 14 * 86_400_000),
    });
    const { cycle: third } = await createCycle(workspace.admin, {
      teamId: workspace.teamId,
      startsAt: second.endsAt,
      endsAt: new Date(second.endsAt.getTime() + 14 * 86_400_000),
    });
    const { issue } = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Rollover race',
      cycleId: first.id,
    });
    await db.execute(
      sql.raw(`
      drop trigger if exists delay_rollover_assignment on issue;
      drop function if exists delay_rollover_assignment();
      create function delay_rollover_assignment() returns trigger as $$
      begin
        perform pg_advisory_xact_lock(731108);
        return new;
      end;
      $$ language plpgsql;
      create trigger delay_rollover_assignment
      before update on issue
      for each row execute function delay_rollover_assignment();
    `),
    );

    const firstConnection = createIsolatedDatabase();
    const secondConnection = createIsolatedDatabase();
    const mutations: RunningOperation<unknown>[] = [];
    try {
      await Promise.all([firstConnection.connect(), secondConnection.connect()]);
      await withHeldAdvisoryLock(731108, async (holder) => {
        const completion = trackOperation(
          completeCycle(workspace.admin, first.id, first.endsAt, firstConnection.database),
        );
        mutations.push(completion);
        await waitForLockCount(holder, 1, [completion]);
        const move = trackOperation(
          updateIssue(workspace.admin, issue.id, { cycleId: third.id }, secondConnection.database),
        );
        mutations.push(move);
        await waitForLockCount(holder, 2, [completion, move]);
      });
      await Promise.all(mutations.map((worker) => worker.result));
    } finally {
      await Promise.allSettled(mutations.map((worker) => worker.result));
      await Promise.all([firstConnection.close(), secondConnection.close()]);
      await db.execute(
        sql.raw(`
        drop trigger delay_rollover_assignment on issue;
        drop function delay_rollover_assignment();
      `),
      );
    }

    expect(await openMemberships(issue.id)).toHaveLength(1);
    expect((await openMemberships(issue.id))[0]?.cycleId).toBe(third.id);
  });

  it('freezes completed, incomplete, canceled, removed, and carryover outcomes at close', async () => {
    const cycle = await firstCycle();
    const { user: assignee } = await addMember(workspace, 'member');
    const { project } = await createProject(workspace.admin, {
      name: 'Launch',
      teamIds: [workspace.teamId],
    });
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: 'Beta',
    });
    const completed = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Completed',
      cycleId: cycle.id,
      estimate: 3,
    });
    await updateIssue(workspace.admin, completed.issue.id, {
      stateId: stateNamed(workspace, 'Done').id,
      estimate: 8,
      assigneeId: assignee.id,
      projectId: project.id,
      milestoneId: milestone.id,
    });
    const incomplete = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Incomplete',
      cycleId: cycle.id,
      estimate: 2,
    });
    await archiveIssue(workspace.admin, incomplete.issue.id);
    const canceled = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Canceled',
      cycleId: cycle.id,
      estimate: 5,
    });
    await updateIssue(workspace.admin, canceled.issue.id, {
      stateId: stateNamed(workspace, 'Canceled').id,
    });
    const removed = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Removed',
      cycleId: cycle.id,
      estimate: 1,
    });
    await updateIssue(workspace.admin, removed.issue.id, { cycleId: null });
    const carryover = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Carryover',
      cycleId: cycle.id,
      estimate: 13,
      stateId: stateNamed(workspace, 'Todo').id,
    });
    const closeTime = new Date(cycle.endsAt.getTime() - 3_600_000);

    const closed = await completeCycle(workspace.admin, cycle.id, closeTime);
    const outcomes = await db
      .select()
      .from(schema.cycleIssueOutcome)
      .where(eq(schema.cycleIssueOutcome.cycleId, cycle.id));
    const byIssue = new Map(outcomes.map((entry) => [entry.issueId, entry]));

    expect(outcomes).toHaveLength(5);
    expect(byIssue.get(completed.issue.id)).toMatchObject({
      outcome: 'completed',
      planned: true,
      estimateAtCommitment: 3,
      estimateAtClose: 8,
      assigneeIdAtClose: assignee.id,
      projectIdAtClose: project.id,
      milestoneIdAtClose: milestone.id,
      rolloverCycleId: null,
    });
    expect(byIssue.get(completed.issue.id)?.completedAt).not.toBeNull();
    expect(byIssue.get(incomplete.issue.id)?.outcome).toBe('incomplete');
    expect(byIssue.get(canceled.issue.id)?.outcome).toBe('canceled');
    expect(byIssue.get(removed.issue.id)?.outcome).toBe('removed');
    expect(byIssue.get(carryover.issue.id)).toMatchObject({
      outcome: 'carryover',
      estimateAtClose: 13,
      rolloverCycleId: closed.nextCycle.id,
    });
    expect(outcomes.every((entry) => entry.closedAt.getTime() === closeTime.getTime())).toBe(true);
  });

  it('attributes one workspace sprint to each issue team through close and rollover', async () => {
    const cycle = await firstCycle();
    const sibling = await createTeam(workspace.admin, { name: 'Platform', key: 'PLAT' });
    const first = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Primary team work',
      cycleId: cycle.id,
      stateId: stateNamed(workspace, 'Todo').id,
    });
    const siblingTodo = sibling.states.find((state) => state.name === 'Todo');
    if (siblingTodo === undefined) throw new Error('missing sibling Todo state');
    const second = await createIssue(workspace.admin, {
      teamId: sibling.team.id,
      title: 'Sibling team work',
      cycleId: cycle.id,
      stateId: siblingTodo.id,
    });

    const closed = await completeCycle(workspace.admin, cycle.id, cycle.endsAt);
    const memberships = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(inArray(schema.cycleIssueMembership.issueId, [first.issue.id, second.issue.id]));
    const outcomes = await db
      .select()
      .from(schema.cycleIssueOutcome)
      .where(eq(schema.cycleIssueOutcome.cycleId, cycle.id));
    const membershipTeams = new Map(
      memberships
        .filter((entry) => entry.cycleId === cycle.id)
        .map((entry) => [entry.issueId, entry.teamId]),
    );
    const outcomeTeams = new Map(outcomes.map((entry) => [entry.issueId, entry.teamId]));

    expect(membershipTeams.get(first.issue.id)).toBe(workspace.teamId);
    expect(membershipTeams.get(second.issue.id)).toBe(sibling.team.id);
    expect(outcomeTeams.get(first.issue.id)).toBe(workspace.teamId);
    expect(outcomeTeams.get(second.issue.id)).toBe(sibling.team.id);
    expect(closed.rolledOverIssueIds.toSorted()).toEqual(
      [first.issue.id, second.issue.id].toSorted(),
    );
    expect(await openMemberships(first.issue.id)).toHaveLength(1);
    expect(await openMemberships(second.issue.id)).toHaveLength(1);
    expect((await openMemberships(first.issue.id))[0]?.cycleId).toBe(closed.nextCycle.id);
    expect((await openMemberships(second.issue.id))[0]?.cycleId).toBe(closed.nextCycle.id);
  });

  it('bootstraps missing current membership before closing the first observed sprint', async () => {
    const cycle = await firstCycle();
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: cycle.id,
      estimate: 8,
    });
    const closeTime = new Date(cycle.endsAt.getTime() - 3_600_000);

    const closed = await completeCycle(workspace.admin, cycle.id, closeTime);
    const [membership] = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(
        and(
          eq(schema.cycleIssueMembership.issueId, issueId),
          eq(schema.cycleIssueMembership.cycleId, cycle.id),
        ),
      );
    const [outcome] = await db
      .select()
      .from(schema.cycleIssueOutcome)
      .where(eq(schema.cycleIssueOutcome.issueId, issueId));

    expect(membership).toMatchObject({
      cycleId: cycle.id,
      entryKind: 'bootstrap',
      coverage: 'observed',
    });
    expect(membership?.removedAt?.getTime()).toBe(closeTime.getTime());
    expect(outcome).toMatchObject({
      cycleId: cycle.id,
      planned: false,
      estimateAtClose: 8,
      outcome: 'carryover',
      rolloverCycleId: closed.nextCycle.id,
    });
  });

  it('repairs a stale source membership before closing and rolling the assigned sprint', async () => {
    const source = await firstCycle();
    const { cycle: destination } = await createCycle(workspace.admin, {
      startsAt: source.endsAt,
      endsAt: new Date(source.endsAt.getTime() + 14 * 86_400_000),
    });
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: destination.id,
      estimate: 5,
    });
    await db.insert(schema.cycleIssueMembership).values({
      id: 'membership_stale_source',
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
      cycleId: source.id,
      issueId,
      issueIdentifier: 'NOVA-1',
      addedAt: source.startsAt,
      entryKind: 'added',
      coverage: 'captured',
    });

    const repaired = await db.transaction(async (tx) =>
      bootstrapCycleMemberships(tx, [destination.id], destination.startsAt),
    );
    const closed = await completeCycle(workspace.admin, destination.id, destination.endsAt);
    const memberships = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.issueId, issueId));
    const [outcome] = await db
      .select()
      .from(schema.cycleIssueOutcome)
      .where(eq(schema.cycleIssueOutcome.issueId, issueId));

    expect(repaired).toBe(1);
    expect(memberships.filter((entry) => entry.removedAt === null)).toHaveLength(1);
    expect(memberships.find((entry) => entry.cycleId === source.id)?.removedAt).not.toBeNull();
    expect(memberships.find((entry) => entry.cycleId === destination.id)?.removedAt).not.toBeNull();
    expect(
      memberships.find((entry) => entry.cycleId === closed.nextCycle.id)?.removedAt,
    ).toBeNull();
    expect(outcome).toMatchObject({
      cycleId: destination.id,
      issueId,
      outcome: 'carryover',
      rolloverCycleId: closed.nextCycle.id,
    });
  });

  it('rolls membership capture back when a later mutation write fails', async () => {
    await db.execute(
      sql.raw(`
      create function reject_issue_activity_after_membership() returns trigger as $$
      begin
        if exists (
          select 1 from cycle_issue_membership where issue_id = new.issue_id
        ) then
          raise exception 'forced later failure';
        end if;
        raise exception 'membership missing before activity';
      end;
      $$ language plpgsql;
      create trigger reject_issue_activity_after_membership
      before insert on issue_activity
      for each row execute function reject_issue_activity_after_membership();
    `),
    );
    const cycle = await firstCycle();

    let failure: unknown;
    try {
      await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title: 'Must roll back',
        cycleId: cycle.id,
      });
    } catch (error) {
      failure = error;
    } finally {
      await db.execute(
        sql.raw(`
        drop trigger reject_issue_activity_after_membership on issue_activity;
        drop function reject_issue_activity_after_membership();
      `),
      );
    }

    expect(errorMessages(failure).some((message) => message.includes('forced later failure'))).toBe(
      true,
    );
    const memberships = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.issueIdentifier, 'NOVA-1'));
    expect(memberships).toEqual([]);
  });

  it('bootstraps current sprint membership once with observed coverage', async () => {
    const cycle = await firstCycle();
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: cycle.id,
      estimate: 5,
    });
    const observedAt = new Date(cycle.startsAt.getTime() + 2 * 86_400_000);

    const first = await db.transaction(async (tx) =>
      bootstrapActiveCycleMemberships(tx, observedAt),
    );
    const second = await db.transaction(async (tx) =>
      bootstrapActiveCycleMemberships(tx, observedAt),
    );
    const [membership] = await db
      .select()
      .from(schema.cycleIssueMembership)
      .where(eq(schema.cycleIssueMembership.issueId, issueId));

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(membership).toMatchObject({
      cycleId: cycle.id,
      entryKind: 'bootstrap',
      coverage: 'observed',
      estimateAtAdd: 5,
    });
    expect(membership?.addedAt.getTime()).toBe(observedAt.getTime());
  });

  it('keeps concurrent bootstrap retries to one open membership', async () => {
    const cycle = await firstCycle();
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: cycle.id,
      estimate: 5,
    });
    const observedAt = new Date(cycle.startsAt.getTime() + 2 * 86_400_000);
    await db.execute(
      sql.raw(`
      drop trigger if exists delay_membership_bootstrap on cycle_issue_membership;
      drop function if exists delay_membership_bootstrap();
      create function delay_membership_bootstrap() returns trigger as $$
      begin
        perform pg_advisory_xact_lock(731109);
        return new;
      end;
      $$ language plpgsql;
      create trigger delay_membership_bootstrap
      before insert on cycle_issue_membership
      for each row execute function delay_membership_bootstrap();
    `),
    );

    const firstConnection = createIsolatedDatabase();
    const secondConnection = createIsolatedDatabase();
    const attempts: RunningOperation<number>[] = [];
    let counts: number[] = [];
    try {
      await Promise.all([firstConnection.connect(), secondConnection.connect()]);
      await withHeldAdvisoryLock(731109, async (holder) => {
        attempts.push(
          trackOperation(
            firstConnection.database.transaction(async (tx) =>
              bootstrapActiveCycleMemberships(tx, observedAt),
            ),
          ),
          trackOperation(
            secondConnection.database.transaction(async (tx) =>
              bootstrapActiveCycleMemberships(tx, observedAt),
            ),
          ),
        );
        await waitForLockCount(holder, 2, attempts);
      });
      counts = await Promise.all(attempts.map((worker) => worker.result));
    } finally {
      await Promise.allSettled(attempts.map((worker) => worker.result));
      await Promise.all([firstConnection.close(), secondConnection.close()]);
      await db.execute(
        sql.raw(`
        drop trigger delay_membership_bootstrap on cycle_issue_membership;
        drop function delay_membership_bootstrap();
      `),
      );
    }

    expect(counts.sort()).toEqual([0, 1]);
    expect(await openMemberships(issueId)).toHaveLength(1);
  });

  it('does not leave stale membership when bootstrap races sprint removal', async () => {
    const cycle = await firstCycle();
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: cycle.id,
    });
    const observedAt = new Date(cycle.startsAt.getTime() + 2 * 86_400_000);
    await db.execute(
      sql.raw(`
      create function delay_bootstrap_before_removal() returns trigger as $$
      begin
        perform pg_advisory_xact_lock(731110);
        return new;
      end;
      $$ language plpgsql;
      create trigger delay_bootstrap_before_removal
      before insert on cycle_issue_membership
      for each row execute function delay_bootstrap_before_removal();
    `),
    );

    const bootstrapConnection = createIsolatedDatabase();
    const removalConnection = createIsolatedDatabase();
    let bootstrap: RunningOperation<number> | undefined;
    let removal: RunningOperation<unknown> | undefined;
    try {
      await Promise.all([bootstrapConnection.connect(), removalConnection.connect()]);
      await withHeldAdvisoryLock(731110, async (holder) => {
        bootstrap = trackOperation(
          bootstrapConnection.database.transaction(async (tx) =>
            bootstrapActiveCycleMemberships(tx, observedAt),
          ),
        );
        await waitForLockCount(holder, 1, [bootstrap]);
        removal = trackOperation(
          updateIssue(workspace.admin, issueId, { cycleId: null }, removalConnection.database),
        );
        await waitForWorkerOrLock(holder, removal, 2);
      });
      if (bootstrap === undefined) throw new Error('The bootstrap operation did not start.');
      if (removal === undefined) throw new Error('The removal operation did not start.');
      await Promise.all([bootstrap.result, removal.result]);
    } finally {
      await Promise.allSettled(
        [bootstrap, removal]
          .filter((worker): worker is RunningOperation<unknown> => worker !== undefined)
          .map((worker) => worker.result),
      );
      await Promise.all([bootstrapConnection.close(), removalConnection.close()]);
      await db.execute(
        sql.raw(`
        drop trigger delay_bootstrap_before_removal on cycle_issue_membership;
        drop function delay_bootstrap_before_removal();
      `),
      );
    }

    expect(await openMemberships(issueId)).toEqual([]);
  });

  it('does not leave membership when bootstrap races hard deletion', async () => {
    const cycle = await firstCycle();
    const issueId = await insertIssue(workspace, {
      number: 1,
      state: 'Todo',
      cycleId: cycle.id,
    });
    const observedAt = new Date(cycle.startsAt.getTime() + 2 * 86_400_000);
    await db.execute(
      sql.raw(`
      create function delay_bootstrap_before_deletion() returns trigger as $$
      begin
        perform pg_advisory_xact_lock(731111);
        return new;
      end;
      $$ language plpgsql;
      create trigger delay_bootstrap_before_deletion
      before insert on cycle_issue_membership
      for each row execute function delay_bootstrap_before_deletion();
    `),
    );

    const bootstrapConnection = createIsolatedDatabase();
    const deletionConnection = createIsolatedDatabase();
    let bootstrap: RunningOperation<number> | undefined;
    let deletion: RunningOperation<unknown> | undefined;
    try {
      await Promise.all([bootstrapConnection.connect(), deletionConnection.connect()]);
      await withHeldAdvisoryLock(731111, async (holder) => {
        bootstrap = trackOperation(
          bootstrapConnection.database.transaction(async (tx) =>
            bootstrapActiveCycleMemberships(tx, observedAt),
          ),
        );
        await waitForLockCount(holder, 1, [bootstrap]);
        deletion = trackOperation(
          deleteIssue(workspace.admin, issueId, deletionConnection.database),
        );
        await waitForWorkerOrLock(holder, deletion, 2);
      });
      if (bootstrap === undefined) throw new Error('The bootstrap operation did not start.');
      if (deletion === undefined) throw new Error('The deletion operation did not start.');
      await Promise.all([bootstrap.result, deletion.result]);
    } finally {
      await Promise.allSettled(
        [bootstrap, deletion]
          .filter((worker): worker is RunningOperation<unknown> => worker !== undefined)
          .map((worker) => worker.result),
      );
      await Promise.all([bootstrapConnection.close(), deletionConnection.close()]);
      await db.execute(
        sql.raw(`
        drop trigger delay_bootstrap_before_deletion on cycle_issue_membership;
        drop function delay_bootstrap_before_deletion();
      `),
      );
    }

    expect(await openMemberships(issueId)).toEqual([]);
  });
});
