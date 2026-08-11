import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { count, db, eq, schema } from '@orbit/db';
import type { SyncAction } from '@orbit/shared/events';

const SECRET = 'an-analytics-cron-secret-that-is-long-enough';
const previousSecret = process.env['CRON_SECRET'];
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

const { GET } = await import('../../../../../src/app/api/cron/analytics-snapshots/route.ts');

afterAll(() => {
  if (previousSecret === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = previousSecret;
  mock.module('@orbit/core', () => core);
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost:3000/api/cron/analytics-snapshots', { headers });
}

async function snapshotCount(cycleId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.cycleProgressSnapshot)
    .where(eq(schema.cycleProgressSnapshot.cycleId, cycleId));
  return Number(row?.total ?? 0);
}

beforeEach(async () => {
  process.env['CRON_SECRET'] = SECRET;
  published.length = 0;
  await resetDatabase();
});

describe('GET /api/cron/analytics-snapshots', () => {
  it('refuses a caller with no authorization without writing or publishing', async () => {
    const workspace = await createWorkspace('Nova');
    const cycle = await core.activeCycle(workspace.admin, workspace.teamId);
    if (cycle === undefined) throw new Error('expected an active sprint');

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await snapshotCount(cycle.id)).toBe(0);
    expect(published).toEqual([]);
  });

  it('refuses the wrong secret without writing or publishing', async () => {
    const workspace = await createWorkspace('Nova');
    const cycle = await core.activeCycle(workspace.admin, workspace.teamId);
    if (cycle === undefined) throw new Error('expected an active sprint');

    const response = await GET(request('Bearer definitely-not-the-secret-value'));

    expect(response.status).toBe(401);
    expect(await snapshotCount(cycle.id)).toBe(0);
    expect(published).toEqual([]);
  });

  it('refuses everything when no secret is configured', async () => {
    await createWorkspace('Nova');
    delete process.env['CRON_SECRET'];

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(published).toEqual([]);
  });

  it('captures active sprints and publishes the returned actions', async () => {
    const workspace = await createWorkspace('Nova');
    const cycle = await core.activeCycle(workspace.admin, workspace.teamId);
    if (cycle === undefined) throw new Error('expected an active sprint');

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ captured: 1 });
    expect(await snapshotCount(cycle.id)).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.some((action) => action.modelId === cycle.id)).toBe(true);
  });

  it('keeps one local-day row when Vercel retries the same run', async () => {
    const workspace = await createWorkspace('Nova');
    const cycle = await core.activeCycle(workspace.admin, workspace.teamId);
    if (cycle === undefined) throw new Error('expected an active sprint');

    const first = await GET(request(`Bearer ${SECRET}`));
    const retry = await GET(request(`Bearer ${SECRET}`));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await snapshotCount(cycle.id)).toBe(1);
    expect(published).toHaveLength(2);
  });
});
