import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { z } from 'zod';

const published: SyncAction[][] = [];
const core = await import('@orbit/core');
mock.module('@orbit/core', () => ({
  ...core,
  publishDeltas: (actions: readonly SyncAction[]) => {
    published.push([...actions]);
    return Promise.resolve(undefined);
  },
}));

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

let actor: Principal = {
  userId: 'nobody',
  organizationId: 'nobody',
  role: 'admin',
  teamIds: [],
};

function activeSession() {
  return Promise.resolve({
    user: { id: actor.userId, name: 'Ada Admin', email: 'ada@orbit.test' },
    session: { activeOrganizationId: actor.organizationId },
  });
}

mock.module('@/lib/auth/session.ts', () => ({
  getSession: activeSession,
  requireSession: activeSession,
}));

mock.module('@/lib/auth/principal.ts', () => ({
  resolveMembership: () =>
    Promise.resolve({
      principal: actor,
      memberId: 'member_1',
      organizationName: 'Nova',
      organizationSlug: 'nova',
    }),
}));

const { DELETE } = await import('@/app/api/issues/[id]/route.ts');

afterAll(() => {
  mock.module('@orbit/core', () => core);
});

const deletedSchema = z.object({
  deleted: z.object({ id: z.string(), identifier: z.string() }),
});
const errorSchema = z.object({ error: z.object({ code: z.string() }) });

let workspace: Workspace;

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  published.length = 0;
  workspace = await createWorkspace('Nova');
  actor = workspace.admin;
});

async function seedIssue(title: string, parentId: string | null = null) {
  const { issue } = await core.createIssue(workspace.admin, {
    teamId: workspace.teamId,
    title,
    ...(parentId === null ? {} : { parentId }),
  });
  return issue;
}

function remove(id: string): Promise<Response> {
  return DELETE(new Request(`http://localhost:3000/api/issues/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

async function rowsLeft(): Promise<string[]> {
  const rows = await db
    .select({ id: schema.issue.id })
    .from(schema.issue)
    .where(eq(schema.issue.organizationId, workspace.organizationId));
  return rows.map((row) => row.id);
}

describe('DELETE /api/issues/[id]', () => {
  it('deletes the issue and reports which one went', async () => {
    const issue = await seedIssue('Doomed');

    const response = await remove(issue.id);
    const payload = deletedSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.deleted).toEqual({ id: issue.id, identifier: issue.identifier });
    expect(await rowsLeft()).toEqual([]);
  });

  it('accepts the human identifier the rest of the route file accepts', async () => {
    const issue = await seedIssue('By identifier');

    const response = await remove(issue.identifier);

    expect(response.status).toBe(200);
    expect(await rowsLeft()).toEqual([]);
  });

  it('refuses a contributor who can see the issue but may not delete it', async () => {
    const issue = await seedIssue('Someone else work');
    const contributor = await addMember(workspace, 'contributor');
    actor = contributor.principal;

    const response = await remove(issue.id);

    expect(response.status).toBe(403);
    expect(errorSchema.parse(await response.json()).error.code).toBe('forbidden');
    expect(await rowsLeft()).toEqual([issue.id]);
    expect(published).toEqual([]);
  });

  it('refuses a guest for the same reason', async () => {
    const issue = await seedIssue('Read only to them');
    const guest = await addMember(workspace, 'guest');
    actor = guest.principal;

    const response = await remove(issue.id);

    expect(response.status).toBe(403);
    expect(await rowsLeft()).toEqual([issue.id]);
  });

  it('hides an issue on a team the member is not on rather than deleting it', async () => {
    const issue = await seedIssue('Other team');
    const outsider = await addMember(workspace, 'member', { teamIds: [] });
    actor = outsider.principal;

    const response = await remove(issue.id);

    expect(response.status).toBe(404);
    expect(await rowsLeft()).toEqual([issue.id]);
  });

  it('fans the delete out with the freed children so no other tab keeps an orphan', async () => {
    const parent = await seedIssue('Parent');
    const child = await seedIssue('Child', parent.id);

    const response = await remove(parent.id);

    expect(response.status).toBe(200);
    expect(await rowsLeft()).toEqual([child.id]);

    const actions = published[0] ?? [];
    expect(actions.map((action) => [action.action, action.modelId])).toEqual([
      ['delete', parent.id],
      ['update', child.id],
    ]);
    expect(actions[1]?.data['parentId']).toBeNull();
  });
});
