import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import { z } from 'zod';

const SECRET = 'a-notifications-cron-secret-that-is-long-enough';
const previousSecret = process.env['CRON_SECRET'];
const core = await import('@orbit/core');
const services = await import('@orbit/services');
const published: SyncAction[][] = [];
const publishDeltas = mock((actions: SyncAction[]) => {
  published.push([...actions]);
  return Promise.resolve();
});
const deliverPendingSlackDms = mock(() => Promise.resolve(3));
const reconcilePendingGithubWork = mock(() =>
  Promise.resolve({
    processed: 4,
    checkHeads: 2,
    pullRequests: 2,
    accepted: 3,
    retryScheduled: 1,
    failed: 0,
    actions: [] as SyncAction[],
  }),
);
const previousSlackEnabled = process.env['SLACK_ENABLED'];
const previousGithubAppId = process.env['GITHUB_APP_ID'];
const previousGithubPrivateKey = process.env['GITHUB_APP_PRIVATE_KEY'];

mock.module('@orbit/core', () => ({ ...core, deliverPendingSlackDms, publishDeltas }));
mock.module('@orbit/services', () => ({ ...services, reconcilePendingGithubWork }));
mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { GET, maxDuration } = await import('../../../../../src/app/api/cron/notifications/route.ts');

afterAll(() => {
  if (previousSecret === undefined) delete process.env['CRON_SECRET'];
  else process.env['CRON_SECRET'] = previousSecret;
  if (previousSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
  else process.env['SLACK_ENABLED'] = previousSlackEnabled;
  if (previousGithubAppId === undefined) delete process.env['GITHUB_APP_ID'];
  else process.env['GITHUB_APP_ID'] = previousGithubAppId;
  if (previousGithubPrivateKey === undefined) delete process.env['GITHUB_APP_PRIVATE_KEY'];
  else process.env['GITHUB_APP_PRIVATE_KEY'] = previousGithubPrivateKey;
  mock.module('@orbit/core', () => core);
  mock.module('@orbit/services', () => services);
});

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
  return new Request('http://localhost:3000/api/cron/notifications', { headers });
}

beforeEach(() => {
  process.env['CRON_SECRET'] = SECRET;
  process.env['SLACK_ENABLED'] = 'true';
  process.env['GITHUB_APP_ID'] = '4514311';
  process.env['GITHUB_APP_PRIVATE_KEY'] = 'private-key';
  deliverPendingSlackDms.mockClear();
  deliverPendingSlackDms.mockImplementation(() => Promise.resolve(3));
  publishDeltas.mockClear();
  published.length = 0;
  reconcilePendingGithubWork.mockClear();
  reconcilePendingGithubWork.mockImplementation(() =>
    Promise.resolve({
      processed: 4,
      checkHeads: 2,
      pullRequests: 2,
      accepted: 3,
      retryScheduled: 1,
      failed: 0,
      actions: [] as SyncAction[],
    }),
  );
});

describe('GET /api/cron/notifications', () => {
  it('runs the durable Slack DM worker across every organization', async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      delivered: 3,
      github: {
        configured: true,
        processed: 4,
        checkHeads: 2,
        pullRequests: 2,
        accepted: 3,
        retryScheduled: 1,
        failed: 0,
      },
    });
    expect(deliverPendingSlackDms).toHaveBeenCalledTimes(1);
    expect(reconcilePendingGithubWork).toHaveBeenCalledTimes(1);
  });

  it('does not run Slack delivery when the integration is disabled', async () => {
    process.env['SLACK_ENABLED'] = 'false';

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      delivered: 0,
      github: {
        configured: true,
        processed: 4,
        checkHeads: 2,
        pullRequests: 2,
        accepted: 3,
        retryScheduled: 1,
        failed: 0,
      },
    });
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
    expect(reconcilePendingGithubWork).toHaveBeenCalledTimes(1);
  });

  it('publishes reconciliation-created inbox actions after the worker commits', async () => {
    const action: SyncAction = {
      syncId: 41,
      organizationId: 'org-1',
      scopes: ['user:user-1'],
      action: 'insert',
      model: 'notification',
      modelId: 'notification-1',
      data: { title: 'Checks failed' },
      actor: { type: 'integration', id: 'github', name: 'GitHub' },
      at: '2026-09-01T00:00:00.000Z',
    };
    reconcilePendingGithubWork.mockImplementationOnce(() =>
      Promise.resolve({
        processed: 1,
        checkHeads: 1,
        pullRequests: 0,
        accepted: 1,
        retryScheduled: 0,
        failed: 0,
        actions: [action],
      }),
    );

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(published).toEqual([[action]]);
    expect(await response.json()).toEqual({
      delivered: 3,
      github: {
        configured: true,
        processed: 1,
        checkHeads: 1,
        pullRequests: 0,
        accepted: 1,
        retryScheduled: 0,
        failed: 0,
      },
    });
  });

  it('reports GitHub reconciliation as unconfigured without app credentials', async () => {
    delete process.env['GITHUB_APP_PRIVATE_KEY'];

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      delivered: 3,
      github: {
        configured: false,
        processed: 0,
        checkHeads: 0,
        pullRequests: 0,
        accepted: 0,
        retryScheduled: 0,
        failed: 0,
      },
    });
    expect(reconcilePendingGithubWork).not.toHaveBeenCalled();
  });

  it('refuses a request without authorization', async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
    expect(reconcilePendingGithubWork).not.toHaveBeenCalled();
  });

  it('refuses the wrong secret', async () => {
    const response = await GET(request('Bearer definitely-not-the-notifications-secret'));

    expect(response.status).toBe(401);
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
    expect(reconcilePendingGithubWork).not.toHaveBeenCalled();
  });

  it('refuses everything when no secret is configured', async () => {
    delete process.env['CRON_SECRET'];

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(deliverPendingSlackDms).not.toHaveBeenCalled();
    expect(reconcilePendingGithubWork).not.toHaveBeenCalled();
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
