import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { SLACK_INTEGRATION_ENABLED } from '@orbit/shared/constants';
import { z } from 'zod';

const SECRET = 'a-notifications-cron-secret-that-is-long-enough';
const previousSecret = process.env['CRON_SECRET'];
const core = await import('@orbit/core');
const slackCapability = await import('@/lib/integrations/slack-capability.ts');
const deliverPendingSlackDms = mock(() => Promise.resolve(3));
let slackEnabledForTest = true;
const slackCapabilitySpy = spyOn(slackCapability, 'slackIntegrationEnabled').mockImplementation(
  () => slackEnabledForTest,
);

mock.module('@orbit/core', () => ({ ...core, deliverPendingSlackDms }));

const { GET, maxDuration } = await import('../../../../../src/app/api/cron/notifications/route.ts');

afterAll(() => {
  if (previousSecret === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = previousSecret;
  mock.module('@orbit/core', () => core);
  slackCapabilitySpy.mockRestore();
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost:3000/api/cron/notifications', { headers });
}

beforeEach(() => {
  process.env['CRON_SECRET'] = SECRET;
  slackEnabledForTest = true;
  deliverPendingSlackDms.mockClear();
  deliverPendingSlackDms.mockImplementation(() => Promise.resolve(3));
});

describe('GET /api/cron/notifications', () => {
  it('runs the durable Slack DM worker for an authorized request', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 3 });
    expect(deliverPendingSlackDms).toHaveBeenCalledTimes(1);
  });

  it('does not run Slack delivery when the integration is disabled', async () => {
    slackEnabledForTest = false;

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 0 });
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
  });

  it('keeps the worker dormant under the shipped capability', async () => {
    slackEnabledForTest = SLACK_INTEGRATION_ENABLED;

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 0 });
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
  });

  it('refuses a request without authorization', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
  });

  it('refuses the wrong secret', async () => {
    const response = await GET(request('Bearer definitely-not-the-notifications-secret'));

    expect(response.status).toBe(401);
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
  });

  it('refuses everything when no secret is configured', async () => {
    delete process.env['CRON_SECRET'];

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
  });

  it('reserves enough runtime for repeated bounded delivery batches', () => {
    expect(maxDuration).toBe(300);
  });
});

const vercelConfigSchema = z.object({
  crons: z.array(z.object({ path: z.string(), schedule: z.string() })),
});

describe('notification delivery schedule', () => {
  it('runs every minute', async () => {
    const url = new URL('../../../../../vercel.json', import.meta.url);
    const config = vercelConfigSchema.parse(JSON.parse(await Bun.file(url).text()));
    const notifications = config.crons.find((cron) => cron.path === '/api/cron/notifications');
    expect(notifications?.schedule).toBe('* * * * *');
  });
});
