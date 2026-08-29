import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { and, db, eq, schema } from '@orbit/db';
import { slackDmAvailable } from '@orbit/services';
import { completeSlackInstall } from '../../../src/features/settings/integrations-connect.ts';

const originalFetch = globalThis.fetch;
let workspace: Workspace;

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle?.() };
}

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

function teamOAuthFetch(teamId: string, accessToken: string): typeof globalThis.fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        access_token: accessToken,
        team: { id: teamId, name: teamId },
        scope: 'chat:write,im:write,users:read,users:read.email',
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

async function mapConnectingUser(): Promise<void> {
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

  it('clears a stale installer mapping when Slack no longer finds the user', async () => {
    await mapConnectingUser();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'users_not_found' }), {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    await complete();

    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));
    expect(mappings).toEqual([]);
    expect(await slackDmAvailable(db, workspace.organizationId, workspace.adminUser.id)).toBe(
      false,
    );
  });

  it('clears a stale installer mapping when Slack lookup fails', async () => {
    await mapConnectingUser();
    globalThis.fetch = Object.assign(
      (..._args: Parameters<typeof globalThis.fetch>) =>
        Promise.reject(new Error('Slack lookup unavailable')),
      { preconnect: globalThis.fetch.preconnect },
    ) satisfies typeof globalThis.fetch;

    await expect(complete()).resolves.toBeUndefined();

    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));
    expect(mappings).toEqual([]);
    expect(await slackDmAvailable(db, workspace.organizationId, workspace.adminUser.id)).toBe(
      false,
    );
  });

  it('rejects an OAuth response without a team before changing the installation', async () => {
    await mapConnectingUser();
    const oauthWithoutTeam = (async () =>
      Response.json({
        ok: true,
        access_token: 'xoxb-unscoped',
        scope: 'chat:write,im:write,users:read,users:read.email',
      })) as unknown as typeof globalThis.fetch;

    let rejected = false;
    try {
      await complete(oauthWithoutTeam);
    } catch {
      rejected = true;
    }

    const [savedIntegration] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));
    expect(rejected).toBe(true);
    expect(savedIntegration).toMatchObject({
      credentials: { botToken: 'xoxb-test' },
      config: { slackTeamId: 'T0123' },
    });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({ slackUserId: 'U0123' });
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

  it('does not persist a stale team mapping from a concurrent OAuth install', async () => {
    const newerAdmin = await addMember(workspace, 'admin', { name: 'Grace Admin' });
    const oldLookupStarted = deferred();
    const releaseOldLookup = deferred();
    globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization');
      if (authorization === 'Bearer xoxb-old-team') {
        oldLookupStarted.resolve();
        await releaseOldLookup.promise;
        return Response.json({
          ok: true,
          user: {
            id: 'U-old-team',
            real_name: 'Ada Admin',
            profile: { email: workspace.adminUser.email, display_name: 'Ada' },
          },
        });
      }
      return Response.json({
        ok: true,
        user: {
          id: 'U-new-team',
          real_name: 'Grace Admin',
          profile: { email: newerAdmin.user.email, display_name: 'Grace' },
        },
      });
    }) as unknown as typeof globalThis.fetch;

    const olderInstall = completeSlackInstall({
      organizationId: workspace.organizationId,
      userId: workspace.adminUser.id,
      code: 'old-code',
      redirectUri: 'https://orbit.test/api/integrations/slack/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: teamOAuthFetch('T-old', 'xoxb-old-team'),
    });
    await oldLookupStarted.promise;
    await completeSlackInstall({
      organizationId: workspace.organizationId,
      userId: newerAdmin.user.id,
      code: 'new-code',
      redirectUri: 'https://orbit.test/api/integrations/slack/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: teamOAuthFetch('T-new', 'xoxb-new-team'),
    });
    releaseOldLookup.resolve();
    await olderInstall;

    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));
    expect(integrations).toHaveLength(1);
    expect(integrations[0]).toMatchObject({
      externalId: 'default',
      connectedById: newerAdmin.user.id,
      credentials: { botToken: 'xoxb-new-team' },
      config: { slackTeamId: 'T-new' },
    });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      userId: newerAdmin.user.id,
      slackUserId: 'U-new-team',
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
