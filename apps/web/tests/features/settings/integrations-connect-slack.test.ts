import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createWorkspace, resetDatabase, type Workspace } from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { completeSlackInstall } from '../../../src/features/settings/integrations-connect.ts';

const originalFetch = globalThis.fetch;
let workspace: Workspace;

function oauthFetch(scope = 'chat:write,im:write,users:read.email'): typeof globalThis.fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        access_token: 'xoxb-test',
        team: { id: 'T0123', name: 'Slack Test' },
        scope,
      }),
      { status: 200 },
    )) as unknown as typeof globalThis.fetch;
}

async function complete(fetch = oauthFetch()): Promise<void> {
  await completeSlackInstall({
    organizationId: workspace.organizationId,
    userId: workspace.adminUser.id,
    code: 'oauth-code',
    redirectUri: 'https://orbit.test/api/integrations/slack/callback',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetch,
  });
}

describe.serial('completeSlackInstall', () => {
  beforeEach(async () => {
    await resetDatabase();
    workspace = await createWorkspace('slack-test');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('persists the granted scopes and maps the connecting user', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          user: {
            id: 'U0123',
            real_name: 'Ada Admin',
            profile: { email: workspace.adminUser.email, display_name: 'Ada' },
          },
        }),
        { status: 200 },
      )) as unknown as typeof globalThis.fetch;

    await complete();

    const [savedIntegration] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    const [mapping] = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));

    expect(savedIntegration).toMatchObject({
      externalId: 'default',
      credentials: { botToken: 'xoxb-test' },
      config: { scopes: ['chat:write', 'im:write', 'users:read.email'], slackTeamId: 'T0123' },
    });
    expect(mapping).toMatchObject({
      integrationId: savedIntegration?.id,
      userId: workspace.adminUser.id,
      slackUserId: 'U0123',
    });
  });

  it('keeps the installation connected when Slack cannot find the user', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'users_not_found' }), {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    await expect(complete()).resolves.toBeUndefined();

    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));
    expect(integrations).toHaveLength(1);
    expect(mappings).toHaveLength(0);
  });

  it('reconnects a legacy default installation in place', async () => {
    const [legacy] = await db
      .insert(schema.integration)
      .values({
        id: 'int_slack_legacy',
        organizationId: workspace.organizationId,
        provider: 'slack',
        externalId: 'default',
        connectedById: workspace.adminUser.id,
        credentials: { botToken: 'xoxb-legacy' },
        config: { scopes: ['chat:write'], slackTeamId: 'T0123' },
      })
      .returning();

    await complete();

    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(integrations).toHaveLength(1);
    expect(integrations[0]).toMatchObject({
      id: legacy?.id,
      externalId: 'default',
      credentials: { botToken: 'xoxb-test' },
      config: { scopes: ['chat:write', 'im:write', 'users:read.email'], slackTeamId: 'T0123' },
    });
  });

  it('rejects installation when the user cannot manage integrations', async () => {
    await db
      .update(schema.member)
      .set({ role: 'member' })
      .where(
        and(
          eq(schema.member.organizationId, workspace.organizationId),
          eq(schema.member.userId, workspace.adminUser.id),
        ),
      );

    let rejected = false;
    try {
      await complete();
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(integrations).toHaveLength(0);
  });
});
