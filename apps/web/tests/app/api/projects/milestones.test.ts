import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { z } from 'zod';
import { mockSession } from '../../../../tests-support.ts';

const coreModule = await import('@orbit/core');

const published: SyncAction[][] = [];

mock.module('@orbit/core', () => ({
  ...coreModule,
  publishDeltas: (actions: SyncAction[]) => {
    published.push(actions);
    return Promise.resolve();
  },
}));

const { createIssue, createMilestone, createProject, createTeam, listMilestones, updateIssue } =
  coreModule;
const { addMember, createWorkspace, resetDatabase } = await import('@orbit/core/test-support');

type Workspace = Awaited<ReturnType<typeof createWorkspace>>;

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

let session: Session | null = null;

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mockSession(() => session);

const listRoute = await import('../../../../src/app/api/projects/[id]/milestones/route.ts');
const reorderRoute = await import(
  '../../../../src/app/api/projects/[id]/milestones/reorder/route.ts'
);
const milestoneRoute = await import('../../../../src/app/api/milestones/[id]/route.ts');

const milestoneShape = z.object({
  milestone: z.object({ id: z.string(), name: z.string(), projectId: z.string() }),
});
const listShape = z.object({
  milestones: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      scope: z.number(),
      completed: z.number(),
    }),
  ),
});
const errorShape = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

let workspace: Workspace;
let projectId: string;

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function post(body: unknown): Request {
  return new Request('http://localhost:3000/api/projects/x/milestones', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function signIn(user: { id: string; name: string; email: string }): void {
  session = { user, session: { activeOrganizationId: workspace.organizationId } };
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
  const { project } = await createProject(workspace.admin, {
    name: 'Launch',
    teamIds: [workspace.teamId],
  });
  projectId = project.id;
});

beforeEach(() => {
  published.length = 0;
  signIn(workspace.adminUser);
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

describe('POST /api/projects/[id]/milestones', () => {
  it('creates the milestone against the project in the path', async () => {
    const response = await listRoute.POST(post({ name: 'Alpha' }), params(projectId));
    const payload = milestoneShape.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.milestone.projectId).toBe(projectId);
    expect((await listMilestones(workspace.admin, projectId)).map((row) => row.name)).toContain(
      'Alpha',
    );
  });

  it('ignores a projectId in the body and uses the one in the path', async () => {
    const { project: other } = await createProject(workspace.admin, {
      name: 'Somewhere else',
      teamIds: [workspace.teamId],
    });

    const response = await listRoute.POST(
      post({ name: 'Smuggled', projectId: other.id }),
      params(projectId),
    );
    const payload = milestoneShape.parse(await response.json());

    expect(payload.milestone.projectId).toBe(projectId);
    expect(await listMilestones(workspace.admin, other.id)).toHaveLength(0);
  });

  it('publishes a delta that stops at the teams of the project', async () => {
    await listRoute.POST(post({ name: 'Fanned out' }), params(projectId));

    const [batch] = published;
    const action = batch?.[0];
    expect(action?.model).toBe('milestone');
    expect(action?.scopes).toContain(scopes.team(workspace.teamId));
    expect(action?.scopes).not.toContain(scopes.organization(workspace.organizationId));
  });

  it('refuses a guest, whose role cannot manage milestones', async () => {
    const guest = await addMember(workspace, 'guest', {
      name: 'Gus Guest',
      teamIds: [workspace.teamId],
    });
    signIn(guest.user);

    const response = await listRoute.POST(post({ name: 'Guest milestone' }), params(projectId));

    expect(response.status).toBe(403);
    expect(errorShape.parse(await response.json()).error.code).toBe('forbidden');
    expect(published).toEqual([]);
    expect((await listMilestones(workspace.admin, projectId)).map((row) => row.name)).not.toContain(
      'Guest milestone',
    );
  });

  it('refuses a member whose teams do not reach the project', async () => {
    const { team } = await createTeam(workspace.admin, { name: 'Outside', key: 'OUT' });
    const outsider = await addMember(workspace, 'member', {
      name: 'Olive Outsider',
      teamIds: [team.id],
    });
    signIn(outsider.user);

    const response = await listRoute.POST(post({ name: 'Sneaked in' }), params(projectId));

    expect(response.status).toBe(404);
    expect(published).toEqual([]);
  });

  it('refuses a signed out caller', async () => {
    session = null;

    const response = await listRoute.POST(post({ name: 'Anonymous' }), params(projectId));

    expect(response.status).toBe(401);
    expect(published).toEqual([]);
  });

  it('rejects a nameless milestone with 422', async () => {
    const response = await listRoute.POST(post({ name: '   ' }), params(projectId));

    expect(response.status).toBe(422);
  });
});

describe('GET /api/projects/[id]/milestones', () => {
  it('lists the milestones of the project in sort order', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Listed',
      teamIds: [workspace.teamId],
    });
    for (const name of ['One', 'Two', 'Three']) {
      await createMilestone(workspace.admin, { projectId: project.id, name });
    }

    const response = await listRoute.GET(
      new Request('http://localhost:3000/api/projects/x/milestones'),
      params(project.id),
    );
    const payload = listShape.parse(await response.json());

    expect(payload.milestones.map((row) => row.name)).toEqual(['One', 'Two', 'Three']);
  });

  it('counts the issues on each milestone on the server, never in the browser', async () => {
    const { project } = await createProject(workspace.admin, {
      name: 'Counted',
      teamIds: [workspace.teamId],
    });
    const { milestone } = await createMilestone(workspace.admin, {
      projectId: project.id,
      name: 'Alpha',
    });
    const done = workspace.states.find((state) => state.category === 'completed');
    if (done === undefined) throw new Error('missing a completed state');

    for (const title of ['Open work', 'Finished work']) {
      const { issue } = await createIssue(workspace.admin, {
        teamId: workspace.teamId,
        title,
        projectId: project.id,
        milestoneId: milestone.id,
      });
      if (title === 'Finished work') {
        await updateIssue(workspace.admin, issue.id, { stateId: done.id });
      }
    }

    const response = await listRoute.GET(
      new Request('http://localhost:3000/api/projects/x/milestones'),
      params(project.id),
    );
    const payload = listShape.parse(await response.json());

    expect(payload.milestones).toEqual([
      expect.objectContaining({ id: milestone.id, scope: 2, completed: 1 }),
    ]);
  });

  it('hides a project the reader teams do not reach', async () => {
    const { team } = await createTeam(workspace.admin, { name: 'Hidden', key: 'HID' });
    const outsider = await addMember(workspace, 'member', {
      name: 'Ida Outsider',
      teamIds: [team.id],
    });
    signIn(outsider.user);

    const response = await listRoute.GET(
      new Request('http://localhost:3000/api/projects/x/milestones'),
      params(projectId),
    );

    expect(response.status).toBe(404);
  });
});

describe('PATCH and DELETE /api/milestones/[id]', () => {
  async function seeded(name: string): Promise<string> {
    const { milestone } = await createMilestone(workspace.admin, { projectId, name });
    return milestone.id;
  }

  it('renames a milestone', async () => {
    const id = await seeded('Before');

    const response = await milestoneRoute.PATCH(
      new Request('http://localhost:3000/api/milestones/x', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'After' }),
      }),
      params(id),
    );
    const payload = milestoneShape.parse(await response.json());

    expect(payload.milestone.name).toBe('After');
  });

  it('deletes a milestone', async () => {
    const id = await seeded('Doomed');

    const response = await milestoneRoute.DELETE(
      new Request('http://localhost:3000/api/milestones/x', { method: 'DELETE' }),
      params(id),
    );

    expect(response.status).toBe(200);
    const rows = await db
      .select({ id: schema.milestone.id })
      .from(schema.milestone)
      .where(eq(schema.milestone.id, id));
    expect(rows).toHaveLength(0);
  });

  it('refuses a contributor, whose role cannot manage milestones', async () => {
    const id = await seeded('Protected');
    const contributor = await addMember(workspace, 'contributor', {
      name: 'Cass Contributor',
      teamIds: [workspace.teamId],
    });
    signIn(contributor.user);

    const patched = await milestoneRoute.PATCH(
      new Request('http://localhost:3000/api/milestones/x', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed by a contributor' }),
      }),
      params(id),
    );
    const removed = await milestoneRoute.DELETE(
      new Request('http://localhost:3000/api/milestones/x', { method: 'DELETE' }),
      params(id),
    );

    expect(patched.status).toBe(403);
    expect(removed.status).toBe(403);
    signIn(workspace.adminUser);
    const still = await listMilestones(workspace.admin, projectId);
    expect(still.map((row) => row.name)).toContain('Protected');
  });
});

describe('POST /api/projects/[id]/milestones/reorder', () => {
  async function threeMilestones(): Promise<{ id: string; names: string[]; ids: string[] }> {
    const { project } = await createProject(workspace.admin, {
      name: `Ordered ${published.length}${Math.random()}`,
      teamIds: [workspace.teamId],
    });
    const ids: string[] = [];
    const names = ['First', 'Second', 'Third'];
    for (const name of names) {
      const { milestone } = await createMilestone(workspace.admin, {
        projectId: project.id,
        name,
      });
      ids.push(milestone.id);
    }
    return { id: project.id, names, ids };
  }

  function reorderRequest(milestoneIds: unknown): Request {
    return new Request('http://localhost:3000/api/projects/x/milestones/reorder', {
      method: 'POST',
      body: JSON.stringify({ milestoneIds }),
    });
  }

  it('writes the order it is given', async () => {
    const project = await threeMilestones();
    const [first, second, third] = project.ids;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('missing seeded milestones');
    }

    const response = await reorderRoute.POST(
      reorderRequest([third, first, second]),
      params(project.id),
    );

    expect(response.status).toBe(200);
    const stored = await listMilestones(workspace.admin, project.id);
    expect(stored.map((row) => row.name)).toEqual(['Third', 'First', 'Second']);
  });

  it('refuses an order that leaves a milestone of the project out', async () => {
    const project = await threeMilestones();
    const [first, second] = project.ids;
    if (first === undefined || second === undefined) throw new Error('missing seeded milestones');

    const response = await reorderRoute.POST(reorderRequest([second, first]), params(project.id));

    expect(response.status).toBe(409);
    const stored = await listMilestones(workspace.admin, project.id);
    expect(stored.map((row) => row.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('refuses an order that pulls in a milestone of another project', async () => {
    const project = await threeMilestones();
    const stray = await createMilestone(workspace.admin, { projectId, name: 'Stray' });
    const [first, second] = project.ids;
    if (first === undefined || second === undefined) throw new Error('missing seeded milestones');

    const response = await reorderRoute.POST(
      reorderRequest([stray.milestone.id, first, second]),
      params(project.id),
    );

    expect(response.status).toBe(409);
  });

  it('rejects a body that is not a list of ids with 422', async () => {
    const project = await threeMilestones();

    const response = await reorderRoute.POST(reorderRequest('First'), params(project.id));

    expect(response.status).toBe(422);
  });

  it('refuses a guest, whose role cannot manage milestones', async () => {
    const project = await threeMilestones();
    const [first, second, third] = project.ids;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('missing seeded milestones');
    }
    const guest = await addMember(workspace, 'guest', {
      name: 'Gil Guest',
      teamIds: [workspace.teamId],
    });
    signIn(guest.user);

    const response = await reorderRoute.POST(
      reorderRequest([third, second, first]),
      params(project.id),
    );

    expect(response.status).toBe(403);
    signIn(workspace.adminUser);
    const stored = await listMilestones(workspace.admin, project.id);
    expect(stored.map((row) => row.name)).toEqual(['First', 'Second', 'Third']);
  });
});
