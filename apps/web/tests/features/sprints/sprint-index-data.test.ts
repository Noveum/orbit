import { beforeEach, describe, expect, it } from 'bun:test';
import { activeCycle, createCycle, createIssue } from '@orbit/core';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { listSprintIndex } from '../../../src/features/sprints/data.ts';

const DAY = 86_400_000;
let workspace: Workspace;
let base: number;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  base = Date.now();
});

function at(days: number): Date {
  return new Date(base + days * DAY);
}

async function sprint(startDay: number, endDay: number) {
  const { cycle } = await createCycle(workspace.admin, {
    startsAt: at(startDay),
    endsAt: at(endDay),
  });
  return cycle;
}

async function entryFor(number: number) {
  const page = await listSprintIndex(workspace.admin, 1);
  return page.sprints.find((row) => row.number === number);
}

describe('listSprintIndex', () => {
  it('calls the sprint covering today running', async () => {
    const running = await activeCycle(workspace.admin);
    if (running === undefined) throw new Error('the workspace opens with a sprint');

    expect((await entryFor(running.number))?.state).toBe('running');
  });

  it('calls a sprint that has not started yet upcoming', async () => {
    const later = await sprint(30, 44);

    expect((await entryFor(later.number))?.state).toBe('upcoming');
  });

  it('calls a sprint past its end date overdue rather than running or finished', async () => {
    const overdue = await sprint(-40, -20);

    expect((await entryFor(overdue.number))?.state).toBe('overdue');
  });

  it('calls a sprint finished only once it has been closed', async () => {
    const overdue = await sprint(-40, -20);

    await db
      .update(schema.cycle)
      .set({ completedAt: new Date() })
      .where(eq(schema.cycle.id, overdue.id));

    expect((await entryFor(overdue.number))?.state).toBe('finished');
  });

  it('never calls two sprints running at once', async () => {
    await sprint(-40, -20);
    await sprint(30, 44);

    const page = await listSprintIndex(workspace.admin, 1);
    const running = page.sprints.filter((row) => row.state === 'running');

    expect(running).toHaveLength(1);
    expect(running[0]?.number).toBe((await activeCycle(workspace.admin))?.number);
  });

  it('counts the live issues each sprint holds and leaves archived ones out', async () => {
    const current = await activeCycle(workspace.admin);
    if (current === undefined) throw new Error('the workspace opens with a sprint');
    const kept = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Counted',
      cycleId: current.id,
    });
    const gone = await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title: 'Archived',
      cycleId: current.id,
    });
    await db
      .update(schema.issue)
      .set({ archivedAt: new Date() })
      .where(eq(schema.issue.id, gone.issue.id));

    const entry = await entryFor(current.number);

    expect(entry?.issues).toBe(1);
    expect(kept.issue.cycleId).toBe(current.id);
  });

  it('reports a sprint holding nothing as zero rather than dropping it', async () => {
    const empty = await sprint(30, 44);

    expect((await entryFor(empty.number))?.issues).toBe(0);
  });

  it('pages newest first and reports the totals the pager needs', async () => {
    for (let index = 0; index < 4; index += 1) await sprint(index * 20 + 30, index * 20 + 44);

    const page = await listSprintIndex(workspace.admin, 1);

    expect(page.total).toBeGreaterThanOrEqual(5);
    expect(page.page).toBe(1);
    expect(page.pageCount).toBeGreaterThanOrEqual(1);
    const starts = page.sprints.map((row) => Date.parse(row.startsAt));
    expect([...starts].sort((left, right) => right - left)).toEqual(starts);
  });

  it('answers an empty page without touching the issue table', async () => {
    const page = await listSprintIndex(workspace.admin, 99);

    expect(page.sprints.every((row) => row.issues >= 0)).toBe(true);
  });
});
