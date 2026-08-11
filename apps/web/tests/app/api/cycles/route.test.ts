import { beforeEach, describe, expect, it } from 'bun:test';
import { activeCycle, completeCycle, createCycle, listCycles } from '@orbit/core';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';
import { z } from 'zod';
import { mockSession } from '../../../../tests-support.ts';

let workspace: Workspace;
let contributorUserId: string;

interface Signed {
  user: { id: string; name: string; email: string };
  session: { activeOrganizationId: string };
}

const signedIn: { value: Signed | null } = { value: null };

mockSession(() => signedIn.value);

const cycles = await import('../../../../src/app/api/cycles/route.ts');
const cycleById = await import('../../../../src/app/api/cycles/[id]/route.ts');
const start = await import('../../../../src/app/api/cycles/[id]/start/route.ts');
const complete = await import('../../../../src/app/api/cycles/[id]/complete/route.ts');

const cycleSchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
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

async function freshSprint(): Promise<{ runningCycleId: string }> {
  const running = await activeCycle(workspace.admin);
  if (running !== undefined) return { runningCycleId: running.id };
  const created = await createCycle(workspace.admin, {
    startsAt: daysFromNow(-1),
    endsAt: daysFromNow(13),
  });
  return { runningCycleId: created.cycle.id };
}

async function storedCycle(id: string) {
  const [row] = await db.select().from(schema.cycle).where(eq(schema.cycle.id, id));
  if (row === undefined) throw new Error(`no cycle ${id}`);
  return row;
}

beforeEach(async () => {
  await resetDatabase();
  workspace = await createWorkspace('Nova');

  const contributor = await addMember(workspace, 'contributor', { name: 'Cass Contributor' });
  contributorUserId = contributor.user.id;

  asUser(workspace.adminUser.id, 'Ada Admin');
});

describe('POST /api/cycles', () => {
  it('appends a sprint after the last one when the client sends no dates', async () => {
    const before = await listCycles(workspace.admin);
    const last = before.at(-1);
    if (last === undefined) throw new Error('the workspace has no sprint');

    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', {}));
    const payload = cycleEnvelope.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.cycle.startsAt).toBe(last.endsAt.toISOString());
    expect(Date.parse(payload.cycle.endsAt) - Date.parse(payload.cycle.startsAt)).toBe(
      14 * 86_400_000,
    );
  });

  it('refuses a role that cannot manage sprints', async () => {
    const before = await listCycles(workspace.admin);
    asUser(contributorUserId, 'Cass Contributor');

    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', {}));

    expect(response.status).toBe(403);
    expect(errorEnvelope.parse(await response.json()).error.code).toBe('forbidden');
    expect(await listCycles(workspace.admin)).toHaveLength(before.length);
  });

  it('answers 401 when nobody is signed in', async () => {
    signedIn.value = null;
    const response = await cycles.POST(postTo('http://localhost:3000/api/cycles', {}));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/cycles/[id]/start', () => {
  it('takes the start date off the server clock and ignores whatever the client sent', async () => {
    const { runningCycleId } = await freshSprint();
    const planned = await createCycle(workspace.admin, {
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
    const planned = await createCycle(workspace.admin, { name: 'Queued' });

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
    const planned = await createCycle(workspace.admin, { name: 'Hands off' });
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

  it('refuses a role that cannot manage sprints from starting one', async () => {
    const planned = await createCycle(workspace.admin, { name: 'Not yours' });
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
    const planned = await createCycle(workspace.admin, { name: 'Before' });

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
    const planned = await createCycle(workspace.admin, { name: 'Untouchable' });
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
    const { runningCycleId } = await freshSprint();
    const states = await db
      .select()
      .from(schema.workflowState)
      .where(eq(schema.workflowState.teamId, workspace.teamId));
    const state = states.find((row) => row.category === 'unstarted');
    if (state === undefined) throw new Error('the team has no unstarted state');
    await db.insert(schema.issue).values({
      id: 'issue_rolls_over',
      organizationId: workspace.organizationId,
      teamId: workspace.teamId,
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
    const { runningCycleId } = await freshSprint();
    asUser(contributorUserId, 'Cass Contributor');

    const response = await complete.POST(
      postTo(`http://localhost:3000/api/cycles/${runningCycleId}/complete`),
      routeParams(runningCycleId),
    );

    expect(response.status).toBe(403);
    expect((await storedCycle(runningCycleId)).completedAt).toBeNull();
  });
});
