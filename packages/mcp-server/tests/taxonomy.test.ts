import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createTeam, DEFAULT_WORKFLOW_STATES, listLabels, listWorkflowStates } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import {
  addMember,
  connect,
  createWorkspace,
  errorPayload,
  MCP_TEST_SCOPES,
  mintToken,
  resetDatabase,
  type TestClient,
  type TestWorkspace,
} from '../src/test-helpers.ts';

let workspace: TestWorkspace;
let admin: TestClient;
let guest: TestClient;
let readOnly: TestClient;
let designKey: string;

interface StateShape {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly position: number;
}

function statesOf(payload: Record<string, unknown>): StateShape[] {
  return payload['states'] as StateShape[];
}

function stateOf(payload: Record<string, unknown>): StateShape {
  return payload['state'] as StateShape;
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  admin = await connect(await mintToken(workspace.organizationId, workspace.adminUser.id));
  const guestMember = await addMember(workspace, 'guest', 'Gus Guest');
  guest = await connect(await mintToken(workspace.organizationId, guestMember.user.id));
  readOnly = await connect(
    await mintToken(
      workspace.organizationId,
      workspace.adminUser.id,
      'Reader',
      MCP_TEST_SCOPES.replace(' orbit.write', ''),
    ),
  );
  designKey = (await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' })).team.key;
});

afterAll(async () => {
  await admin.close();
  await guest.close();
  await readOnly.close();
});

describe('the taxonomy tools are advertised and classified', () => {
  it('offers every label and state tool to a client holding both scopes', async () => {
    const { tools } = await admin.client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('create_state');
    expect(names).toContain('update_state');
    expect(names).toContain('delete_state');
    expect(names).toContain('reorder_states');
    expect(names).toContain('create_label');
    expect(names).toContain('update_label');
    expect(names).toContain('delete_label');
    expect(new Set(names).size).toBe(names.length);
  });

  it('withholds every write from a client that only holds orbit.read', async () => {
    const { tools } = await readOnly.client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('list_states');
    expect(names).toContain('list_labels');
    expect(names).not.toContain('create_state');
    expect(names).not.toContain('update_state');
    expect(names).not.toContain('delete_state');
    expect(names).not.toContain('reorder_states');
    expect(names).not.toContain('create_label');
  });

  it('marks the reads read only and the writes not', async () => {
    const { tools } = await admin.client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get('list_states')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('create_state')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('reorder_states')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('create_label')?.annotations?.readOnlyHint).toBe(false);
  });
});

describe('the state tools reach the same service the app does', () => {
  it('creates a status at the end of the board and lists it back', async () => {
    const created = stateOf(
      await admin.result('create_state', {
        team: workspace.teamKey,
        name: 'Blocked',
        category: 'started',
      }),
    );

    expect(created.position).toBe(DEFAULT_WORKFLOW_STATES.length);
    const listed = statesOf(await admin.result('list_states', { team: workspace.teamKey }));
    expect(listed.map((state) => state.name)).toContain('Blocked');
  });

  it('renames a status by name and keeps its category', async () => {
    const renamed = stateOf(
      await admin.result('update_state', {
        team: workspace.teamKey,
        state: 'Blocked',
        name: 'On hold',
      }),
    );

    expect(renamed.name).toBe('On hold');
    expect(renamed.category).toBe('started');
  });

  it('reorders a board only when every status is named', async () => {
    const before = statesOf(await admin.result('list_states', { team: workspace.teamKey }));

    const partial = await admin.call('reorder_states', {
      team: workspace.teamKey,
      order: before.slice(0, 3).map((state) => state.name),
    });
    expect(errorPayload(partial).code).toBe('conflict');

    const full = statesOf(
      await admin.result('reorder_states', {
        team: workspace.teamKey,
        order: before.map((state) => state.name).reverse(),
      }),
    );
    expect(full.map((state) => state.name)).toEqual(before.map((state) => state.name).reverse());
    expect(full.map((state) => state.position)).toEqual(
      Array.from({ length: before.length }, (_, index) => index),
    );
  });

  it('refuses to delete a status that still holds issues until moveTo names one', async () => {
    await admin.result('create_issue', {
      team: workspace.teamKey,
      title: 'Parked',
      state: 'Todo',
    });

    const refused = await admin.call('delete_state', {
      team: workspace.teamKey,
      state: 'Todo',
    });
    expect(errorPayload(refused).code).toBe('conflict');

    const moved = await admin.result('delete_state', {
      team: workspace.teamKey,
      state: 'Todo',
      moveTo: 'Done',
    });
    expect(moved['movedIssues']).toBe(1);

    const after = statesOf(await admin.result('list_states', { team: workspace.teamKey }));
    expect(after.map((state) => state.name)).not.toContain('Todo');
  });

  it('refuses a guest every state write, because the server checks the role', async () => {
    const created = await guest.call('create_state', {
      team: workspace.teamKey,
      name: 'Sneaky',
      category: 'started',
    });
    const renamed = await guest.call('update_state', {
      team: workspace.teamKey,
      state: 'Done',
      name: 'Sneaky',
    });
    const removed = await guest.call('delete_state', { team: workspace.teamKey, state: 'Triage' });

    expect(errorPayload(created).code).toBe('forbidden');
    expect(errorPayload(renamed).code).toBe('forbidden');
    expect(errorPayload(removed).code).toBe('forbidden');
    const survivors = await listWorkflowStates(workspace.admin, workspace.teamId);
    expect(survivors.map((state) => state.name)).not.toContain('Sneaky');
    expect(survivors.map((state) => state.name)).toContain('Triage');
  });
});

describe('the label tools carry the team scope through', () => {
  it('pins a label to a team and reports it back', async () => {
    const payload = await admin.result('create_label', {
      name: 'Pixel polish',
      color: '#ec4899',
      team: designKey,
    });
    const label = payload['label'] as { id: string; teamId: string | null };

    expect(label.teamId).not.toBeNull();
    const [row] = await db.select().from(schema.label).where(eq(schema.label.id, label.id));
    expect(row?.teamId).toBe(label.teamId ?? '');
  });

  it('widens a team label back to the whole workspace', async () => {
    const payload = await admin.result('update_label', {
      label: 'Pixel polish',
      team: null,
    });
    const label = payload['label'] as { id: string; teamId: string | null };

    expect(label.teamId).toBeNull();
  });

  it('refuses to guess when a workspace label and a team label share a name', async () => {
    await admin.result('create_label', { name: 'Regression', color: '#ef4444' });
    await admin.result('create_label', {
      name: 'Regression',
      color: '#22c55e',
      team: designKey,
    });

    const ambiguous = await admin.call('update_label', { label: 'Regression', color: '#3b82f6' });
    expect(errorPayload(ambiguous).code).toBe('conflict');

    const rows = await db.select().from(schema.label).where(eq(schema.label.name, 'Regression'));
    expect(rows.map((row) => row.color).sort()).toEqual(['#22c55e', '#ef4444']);

    const byId = rows[0];
    if (byId === undefined) throw new Error('the labels vanished');
    const named = await admin.result('update_label', { label: byId.id, color: '#3b82f6' });
    expect((named['label'] as { id: string }).id).toBe(byId.id);
  });

  it('refuses to guess on the issue tools too, not only on the label tools', async () => {
    const created = await admin.call('create_issue', {
      team: designKey,
      title: 'Which regression',
      labels: ['Regression'],
    });
    expect(errorPayload(created).code).toBe('conflict');

    const searched = await admin.call('search_issues', { label: 'Regression' });
    expect(errorPayload(searched).code).toBe('conflict');

    const rows = await db.select().from(schema.label).where(eq(schema.label.name, 'Regression'));
    const named = rows.find((row) => row.teamId !== null);
    if (named === undefined) throw new Error('the team label vanished');
    const accepted = await admin.result('create_issue', {
      team: designKey,
      title: 'That regression',
      labels: [named.id],
    });
    expect((accepted['issue'] as { title: string }).title).toBe('That regression');
  });

  it('refuses a guest every label write', async () => {
    const created = await guest.call('create_label', { name: 'Sneaky' });
    const removed = await guest.call('delete_label', { label: 'Pixel polish' });

    expect(errorPayload(created).code).toBe('forbidden');
    expect(errorPayload(removed).code).toBe('forbidden');
    const survivors = await listLabels(workspace.admin, {});
    expect(survivors.map((label) => label.name)).not.toContain('Sneaky');
    expect(survivors.map((label) => label.name)).toContain('Pixel polish');
  });
});
