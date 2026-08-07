import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createTeam } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
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

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mockSession(() => ({
  user: { id: caller.userId, name: 'Somebody', email: 'somebody@orbit.test' },
  session: { activeOrganizationId: caller.organizationId },
}));

const { GET, POST } = await import('../../../../src/app/api/labels/route.ts');
const {
  GET: READ_ONE,
  PATCH,
  DELETE,
} = await import('../../../../src/app/api/labels/[id]/route.ts');

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  teamId: z.string().nullable(),
});

let nova: Workspace;
let orion: Workspace;
let designTeamId: string;
let orionLabelId: string;
let designLabelId: string;
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

beforeEach(async () => {
  await resetDatabase();
  published.length = 0;
  nova = await createWorkspace('Nova');
  orion = await createWorkspace('Orion');
  const design = await createTeam(nova.admin, { name: 'Design', key: 'DSGN' });
  designTeamId = design.team.id;
  designLabelId = (
    await coreModule.createLabel(nova.admin, {
      name: 'Pixel polish',
      color: '#EC4899',
      teamId: designTeamId,
    })
  ).label.id;
  orionLabelId = (await coreModule.createLabel(orion.admin, { name: 'Theirs', color: '#22C55E' }))
    .label.id;
  contributorId = (await addMember(nova, 'contributor', { teamIds: [nova.teamId] })).principal
    .userId;
  outsiderId = (await addMember(nova, 'member', { teamIds: [nova.teamId] })).principal.userId;
  acting(nova, nova.admin.userId);
});

describe('POST /api/labels', () => {
  it('creates a workspace label and fans it out to the whole workspace', async () => {
    const response = await POST(
      request('/api/labels', 'POST', { name: 'Flaky', color: '#EF4444' }),
    );
    const payload = z.object({ label: labelSchema }).parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.label.teamId).toBeNull();
    expect(published.at(-1)?.scopes).toEqual([scopes.organization(nova.organizationId)]);
  });

  it('refuses a contributor, who has no label:manage, and writes nothing', async () => {
    acting(nova, contributorId);

    const response = await POST(request('/api/labels', 'POST', { name: 'Nope', color: '#EF4444' }));

    expect(response.status).toBe(403);
    expect(await db.select().from(schema.label).where(eq(schema.label.name, 'Nope'))).toHaveLength(
      0,
    );
    expect(published).toHaveLength(0);
  });

  it('refuses a team that belongs to another workspace', async () => {
    const response = await POST(
      request('/api/labels', 'POST', {
        name: 'Stolen',
        color: '#EF4444',
        teamId: orion.teamId,
      }),
    );

    expect(response.status).toBe(404);
    expect(
      await db.select().from(schema.label).where(eq(schema.label.name, 'Stolen')),
    ).toHaveLength(0);
  });

  it('reports a body the validator rejects as a 422', async () => {
    const response = await POST(request('/api/labels', 'POST', { name: '', color: 'purple' }));

    expect(response.status).toBe(422);
    expect(published).toHaveLength(0);
  });
});

describe('GET /api/labels', () => {
  it('never lists a label that belongs to another workspace', async () => {
    const response = await GET(request('/api/labels', 'GET'));
    const payload = z.object({ labels: z.array(labelSchema) }).parse(await response.json());

    expect(payload.labels.map((label) => label.id)).not.toContain(orionLabelId);
    expect(payload.labels.map((label) => label.id)).toContain(designLabelId);
  });

  it('hides a team label from a member who is not on that team', async () => {
    acting(nova, outsiderId);

    const response = await GET(request('/api/labels', 'GET'));
    const payload = z.object({ labels: z.array(labelSchema) }).parse(await response.json());

    expect(payload.labels.map((label) => label.id)).not.toContain(designLabelId);
  });
});

describe('GET, PATCH and DELETE /api/labels/[id]', () => {
  it('answers 404 for a label in another workspace and leaves it untouched', async () => {
    const read = await READ_ONE(
      request(`/api/labels/${orionLabelId}`, 'GET'),
      params(orionLabelId),
    );
    const patched = await PATCH(
      request(`/api/labels/${orionLabelId}`, 'PATCH', { name: 'Stolen' }),
      params(orionLabelId),
    );
    const deleted = await DELETE(
      request(`/api/labels/${orionLabelId}`, 'DELETE'),
      params(orionLabelId),
    );

    expect([read.status, patched.status, deleted.status]).toEqual([404, 404, 404]);
    const [survivor] = await db
      .select()
      .from(schema.label)
      .where(eq(schema.label.id, orionLabelId));
    expect(survivor?.name).toBe('Theirs');
  });

  it('answers 404 for a team label the caller cannot reach', async () => {
    acting(nova, outsiderId);

    const response = await PATCH(
      request(`/api/labels/${designLabelId}`, 'PATCH', { name: 'Mine now' }),
      params(designLabelId),
    );

    expect(response.status).toBe(404);
    const [survivor] = await db
      .select()
      .from(schema.label)
      .where(eq(schema.label.id, designLabelId));
    expect(survivor?.name).toBe('Pixel polish');
  });

  it('narrows a workspace label to a team and reaches both audiences', async () => {
    const created = await coreModule.createLabel(nova.admin, {
      name: 'Flaky',
      color: '#EF4444',
    });
    published.length = 0;

    const response = await PATCH(
      request(`/api/labels/${created.label.id}`, 'PATCH', { teamId: designTeamId }),
      params(created.label.id),
    );
    const payload = z.object({ label: labelSchema }).parse(await response.json());

    expect(payload.label.teamId).toBe(designTeamId);
    expect(published.at(-1)?.scopes.slice().sort()).toEqual(
      [scopes.organization(nova.organizationId), scopes.team(designTeamId)].sort(),
    );
  });

  it('strips the narrowed label off the issues of every other team, over the wire', async () => {
    const created = await coreModule.createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    const outside = await coreModule.createIssue(nova.admin, {
      teamId: nova.teamId,
      title: 'Platform work',
      labelIds: [created.label.id],
    });
    published.length = 0;

    const response = await PATCH(
      request(`/api/labels/${created.label.id}`, 'PATCH', { teamId: designTeamId }),
      params(created.label.id),
    );

    expect(response.status).toBe(200);
    const links = await db
      .select()
      .from(schema.issueLabel)
      .where(eq(schema.issueLabel.issueId, outside.issue.id));
    expect(links).toHaveLength(0);
    const issueAction = published.find((action) => action.model === 'issue');
    expect(issueAction?.modelId).toBe(outside.issue.id);
    expect(issueAction?.scopes).toContain(scopes.team(nova.teamId));
  });

  it('publishes nothing when the patch asks for the values already stored', async () => {
    const created = await coreModule.createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    published.length = 0;

    const response = await PATCH(
      request(`/api/labels/${created.label.id}`, 'PATCH', { name: 'Flaky', color: '#EF4444' }),
      params(created.label.id),
    );

    expect(response.status).toBe(200);
    expect(published).toHaveLength(0);
  });

  it('refuses a body that is not json rather than calling it an empty patch', async () => {
    const created = await coreModule.createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    published.length = 0;

    const response = await PATCH(
      new Request(`http://localhost:3000/api/labels/${created.label.id}`, {
        method: 'PATCH',
        body: '{"name": "Broken"',
      }),
      params(created.label.id),
    );

    expect(response.status).toBe(422);
    expect(published).toHaveLength(0);
    const [survivor] = await db
      .select()
      .from(schema.label)
      .where(eq(schema.label.id, created.label.id));
    expect(survivor?.name).toBe('Flaky');
  });

  it('still takes a patch that sends no body at all as a patch that changes nothing', async () => {
    const created = await coreModule.createLabel(nova.admin, { name: 'Flaky', color: '#EF4444' });
    published.length = 0;

    const response = await PATCH(
      new Request(`http://localhost:3000/api/labels/${created.label.id}`, { method: 'PATCH' }),
      params(created.label.id),
    );

    expect(response.status).toBe(200);
    expect(published).toHaveLength(0);
  });

  it('turns away an id no label could carry before the service is asked', async () => {
    const response = await DELETE(request('/api/labels/x', 'DELETE'), params('l'.repeat(65)));

    expect(response.status).toBe(404);
    expect(published).toHaveLength(0);
  });
});
