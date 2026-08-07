import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { z } from 'zod';

const coreModule = await import('@orbit/core');

const published: SyncAction[][] = [];

mock.module('@orbit/core', () => ({
  ...coreModule,
  publishDeltas: (actions: SyncAction[]) => {
    published.push(actions);
    return Promise.resolve();
  },
}));

const { listProjects, listProjectTeams } = coreModule;
const { addMember, createWorkspace, resetDatabase } = await import('@orbit/core/test-support');

type Workspace = Awaited<ReturnType<typeof createWorkspace>>;

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

let session: Session | null = null;

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

mock.module('@/lib/auth/session.ts', () => ({
  getSession: () => Promise.resolve(session),
  requireSession: () => Promise.resolve(session),
}));

const route = await import('../../../../src/app/api/projects/route.ts');

const createdShape = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    summary: z.string(),
    targetDate: z.string().nullable(),
  }),
});
const errorShape = z.object({ error: z.object({ code: z.string() }) });

let workspace: Workspace;

function signIn(user: { id: string; name: string; email: string }): void {
  session = { user, session: { activeOrganizationId: workspace.organizationId } };
}

function post(body: unknown): Request {
  return new Request('http://localhost:3000/api/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');
});

beforeEach(() => {
  published.length = 0;
  signIn(workspace.adminUser);
});

afterAll(() => {
  mock.module('@orbit/core', () => coreModule);
});

describe('POST /api/projects', () => {
  it('creates a project the projects page can then link to', async () => {
    const response = await route.POST(
      post({
        name: 'Realtime delta protocol',
        summary: 'Fan writes out to every open tab.',
        targetDate: '2031-03-01',
        teamIds: [workspace.teamId],
      }),
    );
    const payload = createdShape.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.project.slug).toBe('realtime-delta-protocol');
    expect(payload.project.summary).toBe('Fan writes out to every open tab.');
    expect(payload.project.targetDate).toBe('2031-03-01');
    expect(
      (await listProjectTeams(workspace.admin, payload.project.id)).map((row) => row.teamId),
    ).toEqual([workspace.teamId]);
  });

  it('derives the slug on the server and never takes one from the body', async () => {
    const response = await route.POST(
      post({ name: 'Slug from the body', slug: 'attacker-chosen', teamIds: [] }),
    );
    const payload = createdShape.parse(await response.json());

    expect(payload.project.slug).toBe('slug-from-the-body');
  });

  it('refuses a contributor, whose role cannot manage projects', async () => {
    const contributor = await addMember(workspace, 'contributor', {
      name: 'Cass Contributor',
      teamIds: [workspace.teamId],
    });
    signIn(contributor.user);

    const response = await route.POST(post({ name: 'Contributor project', teamIds: [] }));

    expect(response.status).toBe(403);
    expect(errorShape.parse(await response.json()).error.code).toBe('forbidden');
    expect(published).toEqual([]);
    signIn(workspace.adminUser);
    expect((await listProjects(workspace.admin)).map((row) => row.name)).not.toContain(
      'Contributor project',
    );
  });

  it('refuses a guest, whose role cannot manage projects', async () => {
    const guest = await addMember(workspace, 'guest', {
      name: 'Gwen Guest',
      teamIds: [workspace.teamId],
    });
    signIn(guest.user);

    const response = await route.POST(post({ name: 'Guest project', teamIds: [] }));

    expect(response.status).toBe(403);
    expect(published).toEqual([]);
  });

  it('refuses a signed out caller', async () => {
    session = null;

    const response = await route.POST(post({ name: 'Anonymous project', teamIds: [] }));

    expect(response.status).toBe(401);
    expect(published).toEqual([]);
  });

  it('refuses a team from another workspace', async () => {
    const elsewhere = await createWorkspace('Elsewhere');

    const response = await route.POST(
      post({ name: 'Cross workspace', teamIds: [elsewhere.teamId] }),
    );

    expect(response.status).toBe(404);
    signIn(workspace.adminUser);
    expect((await listProjects(workspace.admin)).map((row) => row.name)).not.toContain(
      'Cross workspace',
    );
  });

  it('rejects a name that is too short with 422', async () => {
    const response = await route.POST(post({ name: 'a', teamIds: [] }));

    expect(response.status).toBe(422);
  });
});
