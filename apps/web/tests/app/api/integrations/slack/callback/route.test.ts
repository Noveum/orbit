import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { conflict } from '@orbit/shared/errors';

const existingDatabaseUrl = process.env['DATABASE_URL'];
process.env['DATABASE_URL'] ??= 'postgres://orbit:orbit@localhost:5434/orbit_test_web';
const errorLog = spyOn(console, 'error').mockImplementation(() => undefined);

const environment = await import('@/lib/env.ts');
const stateStore = await import('@/lib/integrations/oauth-state-store.ts');
const slackCapability = await import('@/lib/integrations/slack-capability.ts');
const integrationConnect = await import('@/features/settings/integrations-connect.ts');

mock.module('@/lib/env.ts', () => ({
  ...environment,
  absoluteUrl: (path: string) => new URL(path, 'http://localhost:3000').toString(),
  slackAppConfig: () => ({ clientId: 'slack-client', clientSecret: 'slack-secret' }),
}));
mock.module('@/lib/integrations/oauth-state-store.ts', () => ({
  ...stateStore,
  consumeOAuthState: () =>
    Promise.resolve({
      org: 'org_noveum',
      user: 'usr_admin',
      provider: 'slack' as const,
      nonce: 'nonce',
    }),
}));
mock.module('@/lib/integrations/slack-capability.ts', () => ({
  ...slackCapability,
  slackRolloutConfigured: () => true,
  slackIntegrationEnabledForOrganization: (organizationId: string) =>
    organizationId === 'org_noveum',
}));
mock.module('@/features/settings/integrations-connect.ts', () => ({
  ...integrationConnect,
  completeSlackInstall: () =>
    Promise.reject(
      conflict('That Slack workspace is already connected to another Orbit workspace.', {
        details: { reason: 'slack_team_claimed' },
      }),
    ),
}));

const { GET } = await import('@/app/api/integrations/slack/callback/route.ts');

afterAll(() => {
  errorLog.mockRestore();
  if (existingDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
  else process.env['DATABASE_URL'] = existingDatabaseUrl;
  mock.module('@/lib/env.ts', () => environment);
  mock.module('@/lib/integrations/oauth-state-store.ts', () => stateStore);
  mock.module('@/lib/integrations/slack-capability.ts', () => slackCapability);
  mock.module('@/features/settings/integrations-connect.ts', () => integrationConnect);
});

describe('GET /api/integrations/slack/callback', () => {
  it('reports when another Orbit workspace owns the Slack team', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/integrations/slack/callback?code=code&state=state'),
    );
    const location = response.headers.get('location') ?? '';

    expect(response.status).toBe(302);
    expect(location).toContain('slack=claimed');
    expect(location).not.toContain('slack=connected');
  });
});
