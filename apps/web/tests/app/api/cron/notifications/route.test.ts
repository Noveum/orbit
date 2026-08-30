import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { SLACK_INTEGRATION_ENABLED } from '@orbit/shared/constants';
import { z } from 'zod';

const SECRET = 'a-notifications-cron-secret-that-is-long-enough';
const previousSecret = process.env['CRON_SECRET'];
const core = await import('@orbit/core');
const deliverPendingSlackDms = mock(() => Promise.resolve(3));
const previousEnabledOrganizationId = process.env['SLACK_ENABLED_ORGANIZATION_ID'];

mock.module('@orbit/core', () => ({ ...core, deliverPendingSlackDms }));

const { GET, maxDuration } = await import('../../../../../src/app/api/cron/notifications/route.ts');

afterAll(() => {
  if (previousSecret === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = previousSecret;
  if (previousEnabledOrganizationId === undefined)
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];
  else process.env['SLACK_ENABLED_ORGANIZATION_ID'] = previousEnabledOrganizationId;
  mock.module('@orbit/core', () => core);
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost:3000/api/cron/notifications', { headers });
}

beforeEach(() => {
  process.env['CRON_SECRET'] = SECRET;
  process.env['SLACK_ENABLED_ORGANIZATION_ID'] = 'org_noveum';
  deliverPendingSlackDms.mockClear();
  deliverPendingSlackDms.mockImplementation(() => Promise.resolve(3));
});

describe('GET /api/cron/notifications', () => {
  it('runs the durable Slack DM worker only for the configured organization', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 3 });
    expect(deliverPendingSlackDms).toHaveBeenCalledWith(
      expect.anything(),
      100,
      undefined,
      undefined,
      undefined,
      {
        organizationId: 'org_noveum',
      },
    );
  });

  it('does not run Slack delivery when the integration is disabled', async () => {
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: 0 });
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
  });

  it('keeps the worker dormant under the shipped capability', async () => {
    expect(SLACK_INTEGRATION_ENABLED).toBe(false);
    delete process.env['SLACK_ENABLED_ORGANIZATION_ID'];

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
