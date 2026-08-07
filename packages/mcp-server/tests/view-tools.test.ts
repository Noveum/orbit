import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { db, eq, schema, sql } from '@orbit/db';
import {
  connect,
  createWorkspace,
  errorPayload,
  mintToken,
  resetDatabase,
  type TestClient,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;
let admin: TestClient;

interface ViewShape {
  readonly id: string;
  readonly name: string;
  readonly readable: boolean;
  readonly filter: { readonly filter: { readonly children: readonly unknown[] } };
}

const URGENT = {
  kind: 'group',
  combinator: 'and',
  children: [{ kind: 'condition', property: 'priority', operator: 'in', values: ['1'] }],
};

function viewsOf(payload: Record<string, unknown>): ViewShape[] {
  return payload['views'] as ViewShape[];
}

function savedOf(payload: Record<string, unknown>): { id: string; conditions: number } {
  return payload['view'] as { id: string; conditions: number };
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
});

afterAll(async () => {
  await admin.close();
});

describe('creating a view from an assistant that guessed the filter shape', () => {
  it('refuses the guess rather than saving a view that filters nothing', async () => {
    const result = await admin.call('create_view', {
      name: 'Urgent across all teams',
      filter: { priority: ['urgent'] },
    });

    expect(result.isError).toBe(true);
    expect(errorPayload(result).code).toBe('validation_failed');

    const listed = viewsOf(await admin.result('list_views'));
    expect(listed.some((view) => view.name === 'Urgent across all teams')).toBe(false);
  });

  it('names the key it did not recognise so the caller can correct it', async () => {
    const result = await admin.call('create_view', {
      name: 'Unassigned needs an owner',
      filter: { conditions: [{ field: 'assignee', value: null }] },
    });

    expect(errorPayload(result).message).toContain('conditions');
  });

  it('saves the conditions and reports how many landed when the shape is right', async () => {
    const saved = savedOf(
      await admin.result('create_view', {
        name: 'Urgent, properly shaped',
        filter: { filter: URGENT, groupBy: 'assignee' },
      }),
    );

    expect(saved.conditions).toBe(1);
  });
});

describe('listing views so a caller can copy a shape that works', () => {
  it('hands back the filter each view stores', async () => {
    await admin.result('create_view', {
      name: 'Readable by the next caller',
      filter: { filter: URGENT },
    });

    const listed = viewsOf(await admin.result('list_views'));
    const found = listed.find((view) => view.name === 'Readable by the next caller');

    expect(found?.filter.filter.children).toHaveLength(1);
    expect(found?.readable).toBe(true);
  });
});

describe('a view whose stored state cannot be read', () => {
  it('is reported as unreadable rather than as an empty filter', async () => {
    const saved = savedOf(
      await admin.result('create_view', {
        name: 'Written by something older',
        filter: { filter: URGENT },
      }),
    );
    await db
      .update(schema.view)
      .set({ filter: sql`to_jsonb('whatever the old client wrote'::text)` })
      .where(eq(schema.view.id, saved.id));

    const listed = viewsOf(await admin.result('list_views'));
    const found = listed.find((view) => view.name === 'Written by something older');

    expect(found?.readable).toBe(false);
  });
});
