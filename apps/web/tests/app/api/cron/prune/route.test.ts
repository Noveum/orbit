import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { db, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';

const SECRET = 'a-cron-secret-that-is-long-enough';
const before = process.env['CRON_SECRET'];

const { GET } = await import('../../../../../src/app/api/cron/prune/route.ts');

afterAll(() => {
  if (before === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = before;
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost:3000/api/cron/prune', { headers });
}

beforeEach(async () => {
  process.env['CRON_SECRET'] = SECRET;
  await db.delete(schema.webhookDelivery);
});

describe('GET /api/cron/prune', () => {
  it('prunes when Vercel presents the secret', async () => {
    await db.insert(schema.webhookDelivery).values({
      id: randomUUIDv7(),
      provider: 'github',
      deliveryId: randomUUIDv7(),
      event: 'pull_request',
      status: 'processed',
      createdAt: new Date(Date.now() - 400 * 24 * 60 * 60_000),
    });

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);

    const rows = await db.select().from(schema.webhookDelivery);
    expect(rows).toHaveLength(0);
  });

  it('refuses a caller with no authorization at all', async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it('refuses the wrong secret', async () => {
    const response = await GET(request('Bearer not-the-secret-at-all-no'));
    expect(response.status).toBe(401);
  });

  it('refuses a secret that only shares a prefix', async () => {
    const response = await GET(request(`Bearer ${SECRET.slice(0, 10)}`));
    expect(response.status).toBe(401);
  });

  it('refuses everything when no secret is configured, rather than pruning openly', async () => {
    delete process.env['CRON_SECRET'];

    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
  });
});
