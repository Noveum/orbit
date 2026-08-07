import { beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { db, eq, pool, schema, sql } from '@orbit/db';
import { countConditions, inCondition } from '@orbit/shared/filters';
import { createWorkspace, resetDatabase, type Workspace } from '../../src/test-support.ts';
import { createView, getView } from '../../src/work/view-service.ts';

const SCRIPT = new URL('../../../db/catchup/view-filter-repair.sql', import.meta.url);

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

async function savedView(name: string): Promise<string> {
  const created = await createView(workspace.admin, {
    name,
    filter: { filter: URGENT, groupBy: 'label' },
  });
  return created.view.id;
}

async function encodeStoredFilter(viewId: string, layers: number): Promise<void> {
  const [row] = await db.select().from(schema.view).where(eq(schema.view.id, viewId));
  let encoded = JSON.stringify(row?.filter ?? {});
  for (let layer = 1; layer < layers; layer += 1) encoded = JSON.stringify(encoded);
  await db.execute(sql`
    update ${schema.view} set filter = to_jsonb(${encoded}::text) where ${schema.view.id} = ${viewId}
  `);
}

async function storedTypeOf(viewId: string): Promise<string> {
  const [row] = await db.execute<{ kind: string }>(sql`
    select jsonb_typeof(filter) as kind from ${schema.view} where ${schema.view.id} = ${viewId}
  `);
  return String(row?.['kind']);
}

async function runRepair(): Promise<void> {
  const script = await readFile(SCRIPT, 'utf8');
  await pool.unsafe(`set client_min_messages = warning;\n${script}`);
}

describe('the catchup script that repairs a stored view state', () => {
  it('turns an encoded state back into the object it was, whatever the depth', async () => {
    const once = await savedView('Encoded once');
    const twice = await savedView('Encoded twice');
    await encodeStoredFilter(once, 1);
    await encodeStoredFilter(twice, 2);

    await runRepair();

    expect(await storedTypeOf(once)).toBe('object');
    expect(await storedTypeOf(twice)).toBe('object');
    for (const id of [once, twice]) {
      const reloaded = await getView(workspace.admin, id);
      expect(reloaded.readable).toBe(true);
      expect(reloaded.state.groupBy).toBe('label');
      expect(countConditions(reloaded.state.filter)).toBe(1);
    }
  });

  it('leaves a view that was already stored properly exactly as it was', async () => {
    const healthy = await savedView('Already fine');
    const [before] = await db.select().from(schema.view).where(eq(schema.view.id, healthy));

    await runRepair();

    const [after] = await db.select().from(schema.view).where(eq(schema.view.id, healthy));
    expect(after?.filter).toEqual(before?.filter);
  });

  it('leaves a string that is not JSON alone rather than throwing the row away', async () => {
    const nonsense = await savedView('Nonsense');
    await db.execute(sql`
      update ${schema.view}
      set filter = to_jsonb('whatever the old client wrote'::text)
      where ${schema.view.id} = ${nonsense}
    `);

    await runRepair();

    expect(await storedTypeOf(nonsense)).toBe('string');
    expect((await getView(workspace.admin, nonsense)).readable).toBe(false);
  });

  it('never invents a filter for a view that stored none', async () => {
    const created = await createView(workspace.admin, { name: 'Everyone', filter: {} });

    await runRepair();

    const reloaded = await getView(workspace.admin, created.view.id);
    expect(countConditions(reloaded.state.filter)).toBe(0);
  });

  it('leaves an encoded object that is not a view state alone', async () => {
    const viewId = await savedView('Encodes to nonsense');
    await db.execute(sql`
      update ${schema.view}
      set filter = to_jsonb('{"layout":"unknown"}'::text)
      where ${schema.view.id} = ${viewId}
    `);

    await runRepair();

    expect(await storedTypeOf(viewId)).toBe('string');
  });

  it('changes nothing on a second run', async () => {
    const twice = await savedView('Encoded twice');
    await encodeStoredFilter(twice, 2);
    await runRepair();
    const [first] = await db.select().from(schema.view).where(eq(schema.view.id, twice));

    await runRepair();

    const [second] = await db.select().from(schema.view).where(eq(schema.view.id, twice));
    expect(second?.filter).toEqual(first?.filter);
  });
});
