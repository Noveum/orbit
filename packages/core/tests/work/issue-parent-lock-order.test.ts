import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type Database, db, eq, schema } from '@orbit/db';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import { createTeam } from '../../src/org/team-service.ts';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '../../src/test-support.ts';
import { completeCycle, createCycle, deleteCycle } from '../../src/work/cycle-service.ts';
import {
  bulkUpdateIssues,
  createIssue,
  createSubIssues,
  deleteIssue,
  getIssue,
  updateIssue,
} from '../../src/work/issue-service.ts';

let workspace: Workspace;
const pools: ReturnType<typeof postgres>[] = [];

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Parentlocks');
});

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

function connection() {
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('Missing test database.');
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  pools.push(client);
  return client;
}

function parallelDatabase() {
  return drizzle({ client: connection(), schema, casing: 'snake_case' });
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
}

async function waitForBlocked(
  client: ReturnType<typeof postgres>,
  count: number,
  advisory = false,
) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!advisory) await client`select pg_stat_clear_snapshot()`;
    const [row] = advisory
      ? await client<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_locks
          where locktype = 'advisory' and not granted
            and database = (select oid from pg_database where datname = current_database())
        `
      : await client<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
            and state = 'active' and wait_event_type = 'Lock'
        `;
    if ((row?.waiting ?? 0) >= count) return;
    await Bun.sleep(10);
  }
  throw new Error('The requested competing transactions did not reach their lock barrier.');
}

function assertNoDeadlock(outcomes: readonly PromiseSettledResult<unknown>[]) {
  for (const outcome of outcomes) {
    if (outcome.status !== 'rejected') continue;
    const error = z.object({ cause: z.object({ code: z.string() }) }).safeParse(outcome.reason);
    expect(error.success ? error.data.cause.code : undefined).not.toBe('40P01');
  }
}

async function raceAtCycleLock(
  first: (database: Database) => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const client = connection();
  const writer = parallelDatabase();
  const pending: Promise<PromiseSettledResult<unknown>>[] = [];
  await client.unsafe('begin');
  try {
    await client`select pg_advisory_xact_lock(hashtext(${`cycle:${workspace.organizationId}`}))`;
    pending.push(settle(first(writer)));
    await waitForBlocked(client, 1, true);
    pending.push(settle(second()));
    await waitForBlocked(client, 2);
    await client.unsafe('commit');
    return await Promise.all(pending);
  } finally {
    await client.unsafe('rollback').catch(() => undefined);
    await Promise.all(pending);
  }
}

async function issue(title: string, fields: Record<string, unknown> = {}) {
  return (
    await createIssue(workspace.admin, {
      teamId: workspace.teamId,
      title,
      assigneeId: null,
      ...fields,
    })
  ).issue;
}

async function cycle() {
  return (
    await createCycle(workspace.admin, {
      startsAt: new Date('2030-05-01').toISOString(),
      endsAt: new Date('2030-05-15').toISOString(),
    })
  ).cycle;
}

describe('parent and cycle lock ordering', () => {
  it('does not deadlock a parent-and-cycle update against child creation', async () => {
    const sprint = await cycle();
    const parent = await issue('Parent');
    const target = await issue('Target');
    const patch = { parentId: parent.id, cycleId: sprint.id };
    const outcomes = await raceAtCycleLock(
      (database) => updateIssue(workspace.admin, target.id, patch, database),
      () =>
        createSubIssues(workspace.admin, {
          parentId: parent.id,
          issues: [{ title: 'Concurrent child', cycleId: sprint.id }],
        }),
    );
    assertNoDeadlock(outcomes);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await getIssue(workspace.admin, target.id)).toMatchObject(patch);
    expect(
      await db.select().from(schema.issue).where(eq(schema.issue.parentId, parent.id)),
    ).toHaveLength(2);
  });

  it.each(['complete', 'delete'] as const)(
    'does not deadlock a parent-and-cycle update against cycle %s',
    async (operation) => {
      const sprint = await cycle();
      const parent = await issue('Parent', { cycleId: sprint.id });
      const target = await issue('Target');
      const outcomes = await raceAtCycleLock(
        (database) =>
          updateIssue(
            workspace.admin,
            target.id,
            { parentId: parent.id, cycleId: sprint.id },
            database,
          ),
        () =>
          operation === 'complete'
            ? completeCycle(workspace.admin, sprint.id)
            : deleteCycle(workspace.admin, sprint.id),
      );
      assertNoDeadlock(outcomes);
      expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await getIssue(workspace.admin, target.id)).parentId).toBe(parent.id);
    },
  );

  it('rejects one concurrent mutual-parent update without a database deadlock', async () => {
    const left = await issue('Left');
    const right = await issue('Right');
    const client = connection();
    const writer = parallelDatabase();
    const pending: Promise<PromiseSettledResult<unknown>>[] = [];
    await client.unsafe('begin');
    try {
      await client`
        select id from issue where id in (${left.id}, ${right.id}) order by id for update
      `;
      pending.push(settle(updateIssue(workspace.admin, left.id, { parentId: right.id }, writer)));
      pending.push(settle(updateIssue(workspace.admin, right.id, { parentId: left.id })));
      await waitForBlocked(client, 2);
      await client.unsafe('commit');
      const outcomes = await Promise.all(pending);
      assertNoDeadlock(outcomes);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejection).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
      const currentLeft = await getIssue(workspace.admin, left.id);
      const currentRight = await getIssue(workspace.admin, right.id);
      expect(currentLeft.parentId === right.id && currentRight.parentId === left.id).toBe(false);
    } finally {
      await client.unsafe('rollback').catch(() => undefined);
      await Promise.all(pending);
    }
  });

  it('does not deadlock deleting a parent against an older child parent-and-cycle update', async () => {
    const sprint = await cycle();
    const child = await issue('Older child');
    const parent = await issue('Newer parent', { cycleId: sprint.id });
    await updateIssue(workspace.admin, child.id, { parentId: parent.id });
    const outcomes = await raceAtCycleLock(
      (database) => deleteIssue(workspace.admin, parent.id, database),
      () => updateIssue(workspace.admin, child.id, { parentId: parent.id, cycleId: sprint.id }),
    );
    assertNoDeadlock(outcomes);
    const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejection?.status === 'rejected') {
      expect(rejection.reason).toMatchObject({ code: 'not_found' });
    }
    expect(outcomes[0]?.status).toBe('fulfilled');
    expect((await getIssue(workspace.admin, child.id)).parentId).toBeNull();
  });

  it('applies a bulk expected state and mutation only to requested targets, not the locked parent', async () => {
    const sprint = await cycle();
    const parent = await issue('Parent remains unchanged', { priority: 1 });
    const left = await issue('Original target', { priority: 2 });
    const right = await issue('Original target', { priority: 2 });
    const beforeParent = await getIssue(workspace.admin, parent.id);
    const result = await bulkUpdateIssues(workspace.admin, {
      issueIds: [right.id, left.id],
      patch: {
        title: 'Changed target',
        priority: 3,
        cycleId: sprint.id,
        parentId: parent.id,
        expected: { priority: 2 },
      },
    });
    expect(result.issues.map((row) => row.id)).toEqual([right.id, left.id]);
    expect(result.issues.every((row) => row.title === 'Changed target')).toBe(true);
    expect(
      result.actions.filter((action) => action.model === 'issue').map((action) => action.modelId),
    ).toEqual([right.id, left.id]);
    expect(await getIssue(workspace.admin, parent.id)).toEqual(beforeParent);
  });

  it('preserves Human target-only deletion permissions when a child is in another Team', async () => {
    const member = await addMember(workspace, 'member');
    const hidden = await createTeam(workspace.admin, { name: 'Hidden', key: 'HID' });
    const parent = await issue('Visible parent');
    const child = await issue('Hidden child', { teamId: hidden.team.id, parentId: parent.id });
    await expect(getIssue(member.principal, child.id)).rejects.toMatchObject({ code: 'not_found' });
    await deleteIssue(member.principal, parent.id);
    expect(await db.select().from(schema.issue).where(eq(schema.issue.id, parent.id))).toHaveLength(
      0,
    );
    expect((await getIssue(workspace.admin, child.id)).parentId).toBeNull();
  });

  it('retries a Human deletion when a new child commits before the parent lock is acquired', async () => {
    const child = await issue('Concurrent child');
    const parent = await issue('Parent');
    const client = connection();
    let deleting: Promise<PromiseSettledResult<unknown>> | undefined;
    await client.unsafe('begin');
    try {
      await client`select id from issue where id = ${parent.id} for update`;
      deleting = settle(deleteIssue(workspace.admin, parent.id));
      await waitForBlocked(client, 1);
      await client`update issue set parent_id = ${parent.id} where id = ${child.id}`;
      await client.unsafe('commit');
      expect(await deleting).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
      expect((await getIssue(workspace.admin, child.id)).parentId).toBe(parent.id);
      expect((await getIssue(workspace.admin, parent.id)).id).toBe(parent.id);
    } finally {
      await client.unsafe('rollback').catch(() => undefined);
      if (deleting !== undefined) await deleting;
    }
  });
});
