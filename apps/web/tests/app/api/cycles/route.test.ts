import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { completeCycle, createCycle, createTeam, listCycles } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { z } from 'zod';

let workspace: Workspace;
let contributorUserId: string;
let outsiderUserId: string;

interface Signed {
  user: { id: string; name: string; email: string };
  session: { activeOrganizationId: string };
}

const signedIn: { value: Signed | null } = { value: null };

mock.module('@/lib/auth/session.ts', () => ({
  getSession: () => Promise.resolve(signedIn.value),
  requireSession: () => Promise.resolve(signedIn.value),
}));

const cycles = await import('../../../../src/app/api/cycles/route.ts');
const cycleById = await import('../../../../src/app/api/cycles/[id]/route.ts');
const start = await import('../../../../src/app/api/cycles/[id]/start/route.ts');
const complete = await import('../../../../src/app/api/cycles/[id]/complete/route.ts');

const cycleSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  completedAt: z.string().nullable(),
});
const cycleEnvelope = z.object({ cycle: cycleSchema });
const errorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

function asUser(userId: string, name = 'Someone'): void {
  signedIn.value = {
    user: { id: userId, name, email: `${userId}@orbit.test` },
    session: { activeOrganizationId: workspace.organizationId },
  };
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postTo(url: string, body?: unknown): Request {
  return new Request(url, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

let teamCounter = 0;

async function freshTeam(): Promise<{ teamId: string; runningCycleId: string }> {
  teamCounter += 1;
  const bootstrap = await createTeam(workspace.admin, {
    name: `Squad ${teamCounter}`,
    key: `SQ${teamCounter}`,
  });
  return { teamId: bootstrap.team.id, runningCycleId: bootstrap.cycle.id };
}

async function storedCycle(id: string) {
  const [row] = await db.select().from(schema.cycle).where(eq(schema.cycle.id, id));
  if (row === undefined) throw new Error(`no cycle ${id}`);
  return row;
}

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');

  const contributor = await addMember(workspace, 'contributor', { name: 'Cass Contributor' });
  contributorUserId = contributor.user.id;

  const away = await createTeam(workspace.admin, { name: 'Design', key: 'DSGN' });
  const outsider = await addMember(workspace, 'member', {
    name: 'Otto Outsider',
    teamIds: [away.team.id],
  });
  outsiderUserId = outsider.user.id;
});

beforeEach(() => {
  asUser(workspace.adminUser.id, 'Ada Admin');
});

describe('POST /api/cycles', () => {
  it('appends a sprint after the last one when the client sends only a team', async () => {
    const { teamId } = await freshTeam();
    const before = await listCycles(workspace.admin, teamId);
    const last = before.at(-1);
    if (last === undefined) throw new Error('the new team has no sprint');

    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', { teamId }));
    const payload = cycleEnvelope.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.cycle.startsAt).toBe(last.endsAt.toISOString());
    expect(Date.parse(payload.cycle.endsAt) - Date.parse(payload.cycle.startsAt)).toBe(
      14 * 86_400_000,
    );
  });

  it('refuses a role that cannot manage sprints', async () => {
    const { teamId } = await freshTeam();
    const before = await listCycles(workspace.admin, teamId);
    asUser(contributorUserId, 'Cass Contributor');

    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', { teamId }));

    expect(response.status).toBe(403);
    expect(errorEnvelope.parse(await response.json()).error.code).toBe('forbidden');
    expect(await listCycles(workspace.admin, teamId)).toHaveLength(before.length);
  });

  it('refuses a member who is not on the team', async () => {
    const { teamId } = await freshTeam();
    const before = await listCycles(workspace.admin, teamId);
    asUser(outsiderUserId, 'Otto Outsider');

    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', { teamId }));

    expect(response.status).toBe(403);
    expect(await listCycles(workspace.admin, teamId)).toHaveLength(before.length);
  });

  it('answers 401 when nobody is signed in', async () => {
    const { teamId } = await freshTeam();
    signedIn.value = null;
    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', { teamId }));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/cycles/[id]/start', () => {
  it('takes the start date off the server clock and ignores whatever the client sent', async () => {
    const { teamId, runningCycleId } = await freshTeam();
    const planned = await createCycle(workspace.admin, {
      teamId,
      name: 'Later',
      startsAt: daysFromNow(40),
      endsAt: daysFromNow(54),
    });
    await completeCycle(workspace.admin, runningCycleId);
    const forged = new Date('1999-01-01T00:00:00.000Z').toISOString();

    const response = await start.POST(
      postTo(`http://localhost:3000/api/cycles/${planned.cycle.id}/start`, {
        startsAt: forged,
        endsAt: forged,
        completedAt: forged,
      }),
      routeParams(planned.cycle.id),
    );
    const payload = cycleEnvelope.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.cycle.startsAt).not.toBe(forged);
    expect(Math.abs(Date.parse(payload.cycle.startsAt) - Date.now())).toBeLessThan(60_000);
    expect(payload.cycle.completedAt).toBeNull();
    expect(payload.cycle.endsAt).toBe(planned.cycle.endsAt.toISOString());
  });

  it('refuses to start a second sprint while one is running', async () => {
    const { teamId } = await freshTeam();
    const planned = await createCycle(workspace.admin, { teamId, name: 'Queued' });

    const response = await start.POST(
      postTo(`http://localhost:3000/api/cycles/${planned.cycle.id}/start`),
      routeParams(planned.cycle.id),
    );

    expect(response.status).toBe(409);
    expect(errorEnvelope.parse(await response.json()).error.code).toBe('conflict');
    expect((await storedCycle(planned.cycle.id)).startsAt.getTime()).toBe(
      planned.cycle.startsAt.getTime(),
    );
  });

  it('refuses a role that cannot manage sprints, leaving the dates alone', async () => {
    const { teamId } = await freshTeam();
    const planned = await createCycle(workspace.admin, { teamId, name: 'Hands off' });
    asUser(contributorUserId, 'Cass Contributor');

    const response = await start.POST(
      postTo(`http://localhost:3000/api/cycles/${planned.cycle.id}/start`),
      routeParams(planned.cycle.id),
    );

    expect(response.status).toBe(403);
    expect((await storedCycle(planned.cycle.id)).startsAt.getTime()).toBe(
      planned.cycle.startsAt.getTime(),
    );
  });

  it('refuses a member of another team', async () => {
    const { teamId } = await freshTeam();
    const planned = await createCycle(workspace.admin, { teamId, name: 'Not yours' });
    asUser(outsiderUserId, 'Otto Outsider');

    const response = await start.POST(
      postTo(`http://localhost:3000/api/cycles/${planned.cycle.id}/start`),
      routeParams(planned.cycle.id),
    );

    expect(response.status).toBe(403);
    expect((await storedCycle(planned.cycle.id)).startsAt.getTime()).toBe(
      planned.cycle.startsAt.getTime(),
    );
  });

  it('answers 404 for an id that is not an id', async () => {
    const response = await start.POST(
      postTo('http://localhost:3000/api/cycles/nope/start'),
      routeParams('not an id'),
    );
    expect(response.status).toBe(404);
  });
});

describe('PATCH and DELETE /api/cycles/[id]', () => {
  it('renames a sprint for someone who may manage sprints', async () => {
    const { teamId } = await freshTeam();
    const planned = await createCycle(workspace.admin, { teamId, name: 'Before' });

    const response = await cycleById.PATCH(
      new Request(`http://localhost:3000/api/cycles/${planned.cycle.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'After' }),
      }),
      routeParams(planned.cycle.id),
    );

    expect(response.status).toBe(200);
    expect(cycleEnvelope.parse(await response.json()).cycle.name).toBe('After');
  });

  it('refuses a rename and a delete from a role that cannot manage sprints', async () => {
    const { teamId } = await freshTeam();
    const planned = await createCycle(workspace.admin, { teamId, name: 'Untouchable' });
    asUser(contributorUserId, 'Cass Contributor');

    const renamed = await cycleById.PATCH(
      new Request(`http://localhost:3000/api/cycles/${planned.cycle.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Hijacked' }),
      }),
      routeParams(planned.cycle.id),
    );
    expect(renamed.status).toBe(403);

    const deleted = await cycleById.DELETE(
      new Request(`http://localhost:3000/api/cycles/${planned.cycle.id}`, { method: 'DELETE' }),
      routeParams(planned.cycle.id),
    );
    expect(deleted.status).toBe(403);
    expect((await storedCycle(planned.cycle.id)).name).toBe('Untouchable');
  });
});

describe('POST /api/cycles/[id]/complete', () => {
  it('closes the sprint and rolls the unfinished work into the next one', async () => {
    const { teamId, runningCycleId } = await freshTeam();
    const [state] = await db
      .select()
      .from(schema.workflowState)
      .where(eq(schema.workflowState.teamId, teamId));
    if (state === undefined) throw new Error('the team has no workflow state');
    await db.insert(schema.issue).values({
      id: 'issue_rolls_over',
      organizationId: workspace.organizationId,
      teamId,
      number: 1,
      identifier: 'SQ-1',
      title: 'Carried',
      stateId: state.id,
      creatorId: workspace.adminUser.id,
      cycleId: runningCycleId,
    });

    const response = await complete.POST(
      postTo(`http://localhost:3000/api/cycles/${runningCycleId}/complete`),
      routeParams(runningCycleId),
    );
    const payload = z
      .object({
        cycle: cycleSchema,
        nextCycle: cycleSchema,
        rolledOverIssueIds: z.array(z.string()),
      })
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.cycle.completedAt).not.toBeNull();
    expect(payload.rolledOverIssueIds).toEqual(['issue_rolls_over']);

    const [moved] = await db
      .select()
      .from(schema.issue)
      .where(eq(schema.issue.id, 'issue_rolls_over'));
    expect(moved?.cycleId).toBe(payload.nextCycle.id);
  });

  it('refuses a role that cannot manage sprints and leaves the sprint open', async () => {
    const { runningCycleId } = await freshTeam();
    asUser(contributorUserId, 'Cass Contributor');

    const response = await complete.POST(
      postTo(`http://localhost:3000/api/cycles/${runningCycleId}/complete`),
      routeParams(runningCycleId),
    );

    expect(response.status).toBe(403);
    expect((await storedCycle(runningCycleId)).completedAt).toBeNull();
  });
});
