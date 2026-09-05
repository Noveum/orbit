import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import type { Workspace } from '@orbit/core/test-support';

const existingAuthSecret = process.env['BETTER_AUTH_SECRET'];
const existingSlackEnabled = process.env['SLACK_ENABLED'];
process.env['BETTER_AUTH_SECRET'] ??= 'slack-oauth-start-route-test-secret';

const { createWorkspace, resetDatabase } = await import('@orbit/core/test-support');
const environment = await import('@/lib/env.ts');
mock.module('@/lib/env.ts', () => ({
  ...environment,
  absoluteUrl: (path: string) => new URL(path, 'http://localhost:3000').toString(),
  slackAppConfig: () => ({ clientId: 'slack-test-client', clientSecret: 'slack-test-secret' }),
  slackConnectReady: () => true,
}));
const { mockSession } = await import('../../../../../../tests-support.ts');

interface Session {
  readonly user: { id: string; name: string; email: string };
  readonly session: { activeOrganizationId: string };
}

let session: Session | null = null;
let workspace: Workspace;

mockSession(() => session);

const { GET } = await import('@/app/api/integrations/slack/start/route.ts');

beforeAll(async () => {
  await resetDatabase();
  workspace = await createWorkspace('SlackOAuth');
  process.env['SLACK_ENABLED'] = 'true';
  session = {
    user: workspace.adminUser,
    session: { activeOrganizationId: workspace.organizationId },
  };
});

afterAll(() => {
  if (existingAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = existingAuthSecret;
  if (existingSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
  else process.env['SLACK_ENABLED'] = existingSlackEnabled;
  mock.module('@/lib/env.ts', () => environment);
});

describe('GET /api/integrations/slack/start', () => {
  it('requests the exact scopes used by the Slack integration', async () => {
    const response = await GET();
    const location = response.headers.get('location');
    if (location === null) throw new Error('Slack OAuth start did not redirect.');
    const scopes = new URL(location).searchParams.get('scope')?.split(',').sort() ?? [];

    expect(response.status).toBe(302);
    expect(scopes).toEqual(
      [
        'channels:read',
        'chat:write',
        'groups:read',
        'im:write',
        'links:read',
        'links:write',
        'users:read',
        'users:read.email',
      ].sort(),
    );
  });
});
