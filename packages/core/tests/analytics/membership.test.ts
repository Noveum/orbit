import { beforeEach, describe, expect, it } from 'bun:test';
import { asc, db, eq, schema, sql } from '@orbit/db';
import { z } from 'zod';
import { bootstrapActiveCycleMemberships } from '../../src/analytics/membership.ts';
import { insertIssue } from '../../src/analytics/test-fixtures.ts';
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
  moveIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';
import { createMilestone } from '../../src/work/milestone-service.ts';
import { createProject } from '../../src/work/project-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function firstCycle() {
  const [cycle] = await listCycles(workspace.admin, workspace.teamId);
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

async function waitForRaceSetup(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

const workerResultSchema = z.object({ count: z.number().int().nonnegative() });

async function runMembershipWorker(input: unknown): Promise<number> {
  const worker = new URL('./membership-race-worker.ts', import.meta.url).pathname;
  const cwd = new URL('../..', import.meta.url).pathname;
  const child = Bun.spawn(['bun', worker, JSON.stringify(input)], {
    cwd,
    env: { ...process.env, DATABASE_POOL_MAX: '5' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, output, errorOutput] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(errorOutput || `Membership worker exited ${exitCode}.`);
  return workerResultSchema.parse(JSON.parse(output)).count;
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

    const moves: Promise<number>[] = [];
    try {
      await db.transaction(async (holder) => {
        await holder.execute(sql`select pg_advisory_xact_lock(731107)`);
        moves.push(
          runMembershipWorker({
            operation: 'update',
            principal: workspace.admin,
            issueId: issue.id,
            cycleId: second.id,
          }),
        );
        await waitForRaceSetup();
        moves.push(
          runMembershipWorker({
            operation: 'update',
            principal: workspace.admin,
            issueId: issue.id,
            cycleId: third.id,
          }),
        );
        await waitForRaceSetup();
      });
      expect(await Promise.all(moves)).toEqual([1, 1]);
    } finally {
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

    const mutations: Promise<number>[] = [];
    try {
      await db.transaction(async (holder) => {
        await holder.execute(sql`select pg_advisory_xact_lock(731108)`);
        mutations.push(
          runMembershipWorker({
            operation: 'complete',
            principal: workspace.admin,
            cycleId: first.id,
            occurredAt: first.endsAt,
          }),
        );
        await waitForRaceSetup();
        mutations.push(
          runMembershipWorker({
            operation: 'update',
            principal: workspace.admin,
            issueId: issue.id,
            cycleId: third.id,
          }),
        );
        await waitForRaceSetup();
      });
      expect(await Promise.all(mutations)).toEqual([1, 1]);
    } finally {
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

    const attempts: Promise<number>[] = [];
    let counts: number[] = [];
    try {
      await db.transaction(async (holder) => {
        await holder.execute(sql`select pg_advisory_xact_lock(731109)`);
        attempts.push(
          runMembershipWorker({ operation: 'bootstrap', occurredAt: observedAt }),
          runMembershipWorker({ operation: 'bootstrap', occurredAt: observedAt }),
        );
        await waitForRaceSetup();
      });
      counts = await Promise.all(attempts);
    } finally {
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
});
