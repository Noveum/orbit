import { beforeEach, describe, expect, it } from 'bun:test';
import { db, eq, schema, sql } from '@orbit/db';
import { countConditions, inCondition } from '@orbit/shared/filters';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { createView, getView, listViews, updateView } from '../../src/work/view-service.ts';

let workspace: Workspace;

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

const URGENT = {
  kind: 'group' as const,
  combinator: 'and' as const,
  children: [inCondition('priority', ['1'])],
};

async function storedFilter(viewId: string): Promise<unknown> {
  const [row] = await db.select().from(schema.view).where(eq(schema.view.id, viewId));
  return row?.filter;
}

describe('saving a view through the same boundary the MCP tools use', () => {
  it('stores every condition it was given', async () => {
    const created = await createView(workspace.admin, {
      name: 'Urgent across all teams',
      filter: { filter: URGENT, groupBy: 'assignee' },
    });

    expect(countConditions(created.view.state.filter)).toBe(1);
    const reloaded = await getView(workspace.admin, created.view.id);
    expect(countConditions(reloaded.state.filter)).toBe(1);
  });

  it('refuses a filter written in some other shape instead of storing an empty one', async () => {
    const attempt = createView(workspace.admin, {
      name: 'Urgent across all teams',
      filter: { priority: ['urgent'] },
    });

    await expect(attempt).rejects.toThrow();
    const saved = (await listViews(workspace.admin)).filter((view) => !view.virtual);
    expect(saved).toHaveLength(0);
  });

  it('refuses to replace a stored filter with a mis-shaped one', async () => {
    const created = await createView(workspace.admin, {
      name: 'Urgent across all teams',
      filter: { filter: URGENT },
    });

    const attempt = updateView(workspace.admin, created.view.id, {
      filter: { conditions: [{ property: 'priority', values: ['1'] }] },
    });

    await expect(attempt).rejects.toThrow();
    const reloaded = await getView(workspace.admin, created.view.id);
    expect(countConditions(reloaded.state.filter)).toBe(1);
  });

  it('writes the state as an object, never as an encoded string', async () => {
    const created = await createView(workspace.admin, {
      name: 'Urgent across all teams',
      filter: { filter: URGENT },
    });

    expect(typeof (await storedFilter(created.view.id))).toBe('object');
  });
});

describe('reading a view an older client stored as encoded JSON', () => {
  it('recovers it and does not mark it unreadable', async () => {
    const created = await createView(workspace.admin, {
      name: 'Legacy',
      filter: { filter: URGENT, groupBy: 'label' },
    });
    const encoded = JSON.stringify(await storedFilter(created.view.id));
    await db.execute(sql`
      update ${schema.view}
      set filter = to_jsonb(to_jsonb(${encoded}::text)::text)
      where ${schema.view.id} = ${created.view.id}
    `);

    const reloaded = await getView(workspace.admin, created.view.id);

    expect(reloaded.readable).toBe(true);
    expect(reloaded.state.groupBy).toBe('label');
    expect(countConditions(reloaded.state.filter)).toBe(1);
  });

  it('says a state it could not read is unreadable rather than passing off the defaults', async () => {
    const created = await createView(workspace.admin, {
      name: 'Legacy',
      filter: { filter: URGENT },
    });
    await db.execute(sql`
      update ${schema.view}
      set filter = to_jsonb('whatever the old client wrote'::text)
      where ${schema.view.id} = ${created.view.id}
    `);

    const reloaded = await getView(workspace.admin, created.view.id);

    expect(reloaded.readable).toBe(false);
    expect(countConditions(reloaded.state.filter)).toBe(0);
  });
});
