import { afterEach, expect, it } from 'bun:test';

const GATE = 'ORBIT_ISSUE_OUTBOX_DISPATCH';
const previousGate = process.env[GATE];
const previousSecret = process.env['CRON_SECRET'];
const previousRedis = process.env['REDIS_URL'];
const { GET } = await import('@/app/api/cron/issue-outbox/route.ts');

afterEach(() => {
  if (previousGate === undefined) delete process.env[GATE];
  else process.env[GATE] = previousGate;
  if (previousSecret === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = previousSecret;
  if (previousRedis === undefined) delete process.env['REDIS_URL'];
  else process.env['REDIS_URL'] = previousRedis;
});

it('keeps the recovery dispatcher closed until its feature gate is enabled', async () => {
  process.env['CRON_SECRET'] = 'cron-secret';
  process.env['REDIS_URL'] = 'redis://localhost:6380';
  delete process.env[GATE];
  const response = await GET(new Request('http://localhost:3000/api/cron/issue-outbox'));
  expect(response.status).toBe(503);
});

it('authenticates the enabled recovery dispatcher before draining', async () => {
  process.env[GATE] = 'true';
  process.env['CRON_SECRET'] = 'cron-secret';
  process.env['REDIS_URL'] = 'redis://localhost:6380';
  const response = await GET(
    new Request('http://localhost:3000/api/cron/issue-outbox', {
      headers: { authorization: 'Bearer wrong-secret' },
    }),
  );
  expect(response.status).toBe(401);
});
