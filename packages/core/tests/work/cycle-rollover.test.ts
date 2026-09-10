import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import {
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '../../src/test-support.ts';
import {
  activeCycle,
  createCycle,
  listCycles,
  rolloverExpiredCycles,
} from '../../src/work/cycle-service.ts';
import { createIssue, updateIssue } from '../../src/work/issue-service.ts';

let workspace: Workspace;
const week = 7 * 86_400_000;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

async function weeklySprint() {
  const [cycle] = await listCycles(workspace.admin);
  if (cycle === undefined) throw new Error('missing sprint');
  const startsAt = new Date(Date.now() - 86_400_000);
  const endsAt = new Date(startsAt.getTime() + week);
  await db.update(schema.cycle).set({ startsAt, endsAt }).where(eq(schema.cycle.id, cycle.id));
  return { ...cycle, startsAt, endsAt };
}

async function task(cycleId: string, title = 'Unfinished') {
  return (
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      stateId: stateNamed(workspace, 'Todo').id,
      cycleId,
      title,
    })
  ).issue;
}

async function assignedSprint(id: string) {
  const [issue] = await db.select().from(schema.issue).where(eq(schema.issue.id, id));
  return issue?.cycleId;
}

describe('rolloverExpiredCycles', () => {
  it('moves open tasks at the boundary, retains completed tasks, and publishes a weekly successor', async () => {
    const first = await weeklySprint();
    const open = await task(first.id);
    const done = await task(first.id, 'Done');
    await updateIssue(workspace.admin, done.id, { stateId: stateNamed(workspace, 'Done').id });
    const published: SyncAction[] = [];
    expect(
      (await rolloverExpiredCycles({ now: new Date(first.endsAt.getTime() - 1) })).completed,
    ).toBe(0);
    const result = await rolloverExpiredCycles({
      now: first.endsAt,
      publish: (actions) => {
        published.push(...actions);
        return Promise.resolve();
      },
    });
    const current = await activeCycle(workspace.admin, first.endsAt);
    expect(result.completed).toBe(1);
    expect(current?.number).toBe(2);
    expect(current?.endsAt.getTime()).toBe(first.endsAt.getTime() + week);
    expect(await assignedSprint(open.id)).toBe(current?.id);
    expect(await assignedSprint(done.id)).toBe(first.id);
    expect(published).toEqual(result.actions);
    expect(
      result.actions.some((action) => action.action === 'insert' && action.modelId === current?.id),
    ).toBe(true);
    expect(result.actions.every((action) => action.actor.type === 'system')).toBe(true);
    expect((await rolloverExpiredCycles({ now: first.endsAt })).completed).toBe(0);
  });

  it('uses a scheduled successor and catches up multiple missed weeks', async () => {
    const first = await weeklySprint();
    const open = await task(first.id);
    const { cycle: second } = await createCycle(workspace.admin, {
      startsAt: first.endsAt,
      endsAt: new Date(first.endsAt.getTime() + week),
    });
    const now = second.endsAt;
    expect((await rolloverExpiredCycles({ now })).completed).toBe(2);
    const current = await activeCycle(workspace.admin, now);
    expect(current?.number).toBe(3);
    expect(await assignedSprint(open.id)).toBe(current?.id);
    expect(await listCycles(workspace.admin)).toHaveLength(3);
  });

  it('makes concurrent cron invocations safe', async () => {
    const first = await weeklySprint();
    const open = await task(first.id);
    const results = await Promise.all([
      rolloverExpiredCycles({ now: first.endsAt }),
      rolloverExpiredCycles({ now: first.endsAt }),
    ]);
    expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
    expect(await listCycles(workspace.admin)).toHaveLength(2);
    expect(await assignedSprint(open.id)).toBe(
      (await activeCycle(workspace.admin, first.endsAt))?.id,
    );
  });

  it('does not roll archived sprints and bounds catch-up work', async () => {
    const first = await weeklySprint();
    await db
      .update(schema.cycle)
      .set({ archivedAt: new Date() })
      .where(eq(schema.cycle.id, first.id));
    expect((await rolloverExpiredCycles({ now: first.endsAt })).completed).toBe(0);
    await db.update(schema.cycle).set({ archivedAt: null }).where(eq(schema.cycle.id, first.id));
    expect(
      (await rolloverExpiredCycles({ now: new Date(first.endsAt.getTime() + 3 * week), limit: 2 }))
        .completed,
    ).toBe(2);
  });

  it('rejects new assignments to an expired sprint before cron runs', async () => {
    const first = await weeklySprint();
    await db
      .update(schema.cycle)
      .set({ endsAt: new Date(Date.now() - 1) })
      .where(eq(schema.cycle.id, first.id));
    await expect(task(first.id)).rejects.toMatchObject({
      message: 'That sprint is no longer open.',
    });
  });
});
