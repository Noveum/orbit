import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createWorkspace, resetDatabase } from '@orbit/core/test-support';
import { db, eq, schema } from '@orbit/db';

mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
const { GET } = await import('../../../../../src/app/api/cron/sprint-rollover/route.ts');

const secret = 'sprint-rollover-secret';
const previousSecret = process.env['CRON_SECRET'];

beforeEach(async () => {
  process.env['CRON_SECRET'] = secret;
  await resetDatabase();
});

afterAll(() => {
  if (previousSecret === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = previousSecret;
});

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost/api/cron/sprint-rollover', { headers });
}

describe('GET /api/cron/sprint-rollover', () => {
  it('requires the configured bearer secret', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer x'))).status).toBe(401);
    delete process.env['CRON_SECRET'];
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503);
  });

  it('closes expired sprints on an authenticated invocation and is safe to repeat', async () => {
    const workspace = await createWorkspace('Nova');
    const endsAt = new Date(Date.now() - 1000);
    await db
      .update(schema.cycle)
      .set({ startsAt: new Date(endsAt.getTime() - 7 * 86_400_000), endsAt })
      .where(eq(schema.cycle.organizationId, workspace.organizationId));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completed: 1 });
    expect(await (await GET(request(`Bearer ${secret}`))).json()).toEqual({ completed: 0 });
  });
});
