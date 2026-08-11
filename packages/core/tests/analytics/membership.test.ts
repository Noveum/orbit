import { beforeEach, describe, expect, it } from 'bun:test';
import { asc, db, eq, schema, sql } from '@orbit/db';
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
import { archiveIssue, createIssue, updateIssue } from '../../src/work/issue-service.ts';
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
});
