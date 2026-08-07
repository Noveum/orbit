import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createTeam } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  stateNamed,
  type Workspace,
} from '@orbit/core/test-support';
import { asc, db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { z } from 'zod';
import { mockSession } from '../../../../tests-support.ts';

const coreModule = await import('@orbit/core');
const published: SyncAction[] = [];

mock.module('@orbit/core', () => ({
  ...coreModule,
  publishDeltas: (actions: SyncAction[]) => {
    published.push(...actions);
    return Promise.resolve();
  },
}));

interface Caller {
  readonly userId: string;
  readonly organizationId: string;
}

let caller: Caller = { userId: '', organizationId: '' };

const session = () =>
  Promise.resolve({
    user: { id: caller.userId, name: 'Somebody', email: 'somebody@orbit.test' },
    session: { activeOrganizationId: caller.organizationId },
  });

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mockSession(session);

const { GET, POST } = await import('../../../../src/app/api/workflow-states/route.ts');
const { PATCH, DELETE } = await import('../../../../src/app/api/workflow-states/[id]/route.ts');
const { POST: REORDER } = await import('../../../../src/app/api/workflow-states/reorder/route.ts');

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

const stateSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  category: z.string(),
  position: z.number(),
});

let nova: Workspace;
let vega: Workspace;
let designTeamId: string;
let contributorId: string;
let outsiderId: string;

function acting(workspace: Workspace, userId: string): void {
  caller = { userId, organizationId: workspace.organizationId };
}

function request(path: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function statesOf(teamId: string) {
  return await db
    .select()
    .from(schema.workflowState)
    .where(eq(schema.workflowState.teamId, teamId))
    .orderBy(asc(schema.workflowState.position));
}

beforeEach(async () => {
  await resetDatabase();
  published.length = 0;
  nova = await createWorkspace('Nova');
  vega = await createWorkspace('Vega');
  designTeamId = (await createTeam(nova.admin, { name: 'Design', key: 'DSGN' })).team.id;
  contributorId = (await addMember(nova, 'contributor', { teamIds: [nova.teamId] })).principal
    .userId;
  outsiderId = (await addMember(nova, 'member', { teamIds: [nova.teamId] })).principal.userId;
  acting(nova, nova.admin.userId);
});

describe('POST /api/workflow-states', () => {
  it('appends the status at the end and fans it out to the team only', async () => {
    const response = await POST(
      request('/api/workflow-states', 'POST', {
        teamId: nova.teamId,
        name: 'Blocked',
        category: 'started',
        color: '#EF4444',
      }),
    );
    const payload = z.object({ state: stateSchema }).parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.state.position).toBe(7);
    expect(published.at(-1)?.scopes).toEqual([scopes.team(nova.teamId)]);
  });

  it('ignores a position the caller sends, because the server owns the order', async () => {
    const response = await POST(
      request('/api/workflow-states', 'POST', {
        teamId: nova.teamId,
        name: 'Blocked',
        category: 'started',
        color: '#EF4444',
        position: 0,
      }),
    );
    const payload = z.object({ state: stateSchema }).parse(await response.json());

    expect(payload.state.position).toBe(7);
    expect((await statesOf(nova.teamId)).map((state) => state.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('refuses a contributor and writes nothing', async () => {
    acting(nova, contributorId);

    const response = await POST(
      request('/api/workflow-states', 'POST', {
        teamId: nova.teamId,
        name: 'Nope',
        category: 'started',
        color: '#EF4444',
      }),
    );

    expect(response.status).toBe(403);
    expect(await statesOf(nova.teamId)).toHaveLength(7);
    expect(published).toHaveLength(0);
  });

  it('refuses a team in another workspace', async () => {
    const response = await POST(
      request('/api/workflow-states', 'POST', {
        teamId: vega.teamId,
        name: 'Smuggled',
        category: 'started',
        color: '#EF4444',
      }),
    );

    expect(response.status).toBe(404);
    expect(await statesOf(vega.teamId)).toHaveLength(7);
  });
});

describe('GET /api/workflow-states', () => {
  it('refuses a team in another workspace and a team the caller has not joined', async () => {
    const foreign = await GET(request(`/api/workflow-states?teamId=${vega.teamId}`, 'GET'));
    acting(nova, outsiderId);
    const unjoined = await GET(request(`/api/workflow-states?teamId=${designTeamId}`, 'GET'));

    expect(foreign.status).toBe(404);
    expect(unjoined.status).toBe(403);
  });

  it('needs a team, so a bare call is a 422 rather than every team at once', async () => {
    const response = await GET(request('/api/workflow-states', 'GET'));

    expect(response.status).toBe(422);
  });
});

describe('PATCH /api/workflow-states/[id]', () => {
  it('refuses a status in another workspace and leaves the name alone', async () => {
    const theirs = (await statesOf(vega.teamId))[0];
    if (theirs === undefined) throw new Error('the other workspace had no states');

    const response = await PATCH(
      request(`/api/workflow-states/${theirs.id}`, 'PATCH', { name: 'Stolen' }),
      params(theirs.id),
    );

    expect(response.status).toBe(404);
    expect((await statesOf(vega.teamId))[0]?.name).toBe(theirs.name);
  });

  it('refuses a member who is not on that team', async () => {
    acting(nova, outsiderId);
    const theirs = (await statesOf(designTeamId))[0];
    if (theirs === undefined) throw new Error('the design team had no states');

    const response = await PATCH(
      request(`/api/workflow-states/${theirs.id}`, 'PATCH', { name: 'Mine now' }),
      params(theirs.id),
    );

    expect(response.status).toBe(403);
    expect((await statesOf(designTeamId))[0]?.name).toBe(theirs.name);
  });

  it('publishes nothing when the patch asks for the values already stored', async () => {
    const todo = stateNamed(nova, 'Todo');
    published.length = 0;

    const response = await PATCH(
      request(`/api/workflow-states/${todo.id}`, 'PATCH', {
        name: todo.name,
        category: 'unstarted',
        color: todo.color,
      }),
      params(todo.id),
    );

    expect(response.status).toBe(200);
    expect(published).toHaveLength(0);
  });

  it('refuses a category the enum does not know', async () => {
    const todo = stateNamed(nova, 'Todo');

    const response = await PATCH(
      request(`/api/workflow-states/${todo.id}`, 'PATCH', { category: 'nearly_done' }),
      params(todo.id),
    );

    expect(response.status).toBe(422);
  });
});

describe('DELETE /api/workflow-states/[id]', () => {
  it('refuses a status that still holds issues until a replacement is named', async () => {
    const todo = stateNamed(nova, 'Todo');
    const created = await coreModule.createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Parked',
      stateId: todo.id,
    });

    const refused = await DELETE(
      request(`/api/workflow-states/${todo.id}`, 'DELETE'),
      params(todo.id),
    );

    expect(refused.status).toBe(409);
    const [issue] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, created.issue.id));
    expect(issue?.stateId).toBe(todo.id);
  });

  it('moves the issues and deletes the status when a replacement is named', async () => {
    const todo = stateNamed(nova, 'Todo');
    const done = stateNamed(nova, 'Done');
    const created = await coreModule.createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    published.length = 0;

    const response = await DELETE(
      request(`/api/workflow-states/${todo.id}?moveToStateId=${done.id}`, 'DELETE'),
      params(todo.id),
    );

    expect(response.status).toBe(200);
    const [issue] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, created.issue.id));
    expect(issue?.stateId).toBe(done.id);
    expect(issue?.completedAt).not.toBeNull();
    expect((await statesOf(nova.teamId)).map((state) => state.id)).not.toContain(todo.id);
    expect(published.some((action) => action.model === 'issue')).toBe(true);
  });

  it('refuses a replacement on another team', async () => {
    const todo = stateNamed(nova, 'Todo');
    await coreModule.createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Parked',
      stateId: todo.id,
    });
    const theirs = (await statesOf(designTeamId))[0];
    if (theirs === undefined) throw new Error('the design team had no states');

    const response = await DELETE(
      request(`/api/workflow-states/${todo.id}?moveToStateId=${theirs.id}`, 'DELETE'),
      params(todo.id),
    );

    expect(response.status).toBe(422);
    expect((await statesOf(nova.teamId)).map((state) => state.id)).toContain(todo.id);
  });

  it('refuses a contributor', async () => {
    acting(nova, contributorId);
    const triage = stateNamed(nova, 'Triage');

    const response = await DELETE(
      request(`/api/workflow-states/${triage.id}`, 'DELETE'),
      params(triage.id),
    );

    expect(response.status).toBe(403);
    expect((await statesOf(nova.teamId)).map((state) => state.id)).toContain(triage.id);
  });
});

describe('POST /api/workflow-states/reorder', () => {
  it('refuses a partial order so two columns cannot land on one position', async () => {
    const before = await statesOf(nova.teamId);

    const response = await REORDER(
      request('/api/workflow-states/reorder', 'POST', {
        teamId: nova.teamId,
        stateIds: before.slice(0, 3).map((state) => state.id),
      }),
    );

    expect(response.status).toBe(409);
    expect((await statesOf(nova.teamId)).map((state) => state.id)).toEqual(
      before.map((state) => state.id),
    );
  });

  it('renumbers the board when the whole order arrives', async () => {
    const before = await statesOf(nova.teamId);
    const flipped = before.map((state) => state.id).reverse();

    const response = await REORDER(
      request('/api/workflow-states/reorder', 'POST', {
        teamId: nova.teamId,
        stateIds: flipped,
      }),
    );

    expect(response.status).toBe(200);
    const after = await statesOf(nova.teamId);
    expect(after.map((state) => state.id)).toEqual(flipped);
    expect(after.map((state) => state.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('refuses a contributor even with a perfectly formed order', async () => {
    const before = await statesOf(nova.teamId);
    acting(nova, contributorId);

    const response = await REORDER(
      request('/api/workflow-states/reorder', 'POST', {
        teamId: nova.teamId,
        stateIds: before.map((state) => state.id).reverse(),
      }),
    );

    expect(response.status).toBe(403);
    expect((await statesOf(nova.teamId)).map((state) => state.id)).toEqual(
      before.map((state) => state.id),
    );
  });

  it('refuses a team in another workspace', async () => {
    const theirs = await statesOf(vega.teamId);

    const response = await REORDER(
      request('/api/workflow-states/reorder', 'POST', {
        teamId: vega.teamId,
        stateIds: theirs.map((state) => state.id).reverse(),
      }),
    );

    expect(response.status).toBe(404);
    expect((await statesOf(vega.teamId)).map((state) => state.id)).toEqual(
      theirs.map((state) => state.id),
    );
  });
});
