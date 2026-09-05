import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  addMember,
  createWorkspace,
  resetDatabase,
  type Workspace,
} from '@orbit/core/test-support';
import { and, db, eq, schema, sql } from '@orbit/db';
import { ensureSlackIntegration, slackDmAvailable } from '@orbit/services';
import { decryptSlackBotToken, hasSlackBotToken } from '@orbit/services/slack/credentials';
import { completeSlackInstall } from '../../../src/features/settings/integrations-connect.ts';

const originalFetch = globalThis.fetch;
const originalAuthSecret = process.env['BETTER_AUTH_SECRET'];
const originalSlackEnabled = process.env['SLACK_ENABLED'];
let workspace: Workspace;

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let settle: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: () => settle?.() };
}

function oauthFetch(
  scope = 'chat:write,im:write,users:read,users:read.email',
): typeof globalThis.fetch {
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
        members: [
          {
            id: 'U0123',
            deleted: false,
            is_bot: false,
            is_app_user: false,
            real_name: 'Ada Admin',
            profile: { email: workspace.adminUser.email, display_name: 'Ada' },
          },
        ],
        response_metadata: { next_cursor: '' },
      }),
      { status: 200 },
    )) as unknown as typeof globalThis.fetch;
  await complete();
}

describe.serial('completeSlackInstall', () => {
  beforeEach(async () => {
    process.env['BETTER_AUTH_SECRET'] = 'slack-oauth-install-test-secret';
    await resetDatabase();
    workspace = await createWorkspace('slack-test');
    process.env['SLACK_ENABLED'] = 'true';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = originalAuthSecret;
    if (originalSlackEnabled === undefined) delete process.env['SLACK_ENABLED'];
    else process.env['SLACK_ENABLED'] = originalSlackEnabled;
  });

  it('persists the granted scopes and maps every current workspace member', async () => {
    const teammate = await addMember(workspace, 'member', { name: 'Grace Member' });
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          members: [
            {
              id: 'U0123',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Ada Admin',
              profile: { email: workspace.adminUser.email, display_name: 'Ada' },
            },
            {
              id: 'U0456',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Grace Member',
              profile: { email: teammate.user.email, display_name: 'Grace' },
            },
          ],
          response_metadata: { next_cursor: '' },
        }),
        { status: 200 },
      )) as unknown as typeof globalThis.fetch;

    await complete();

    const [savedIntegration] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));

    expect(savedIntegration).toMatchObject({
      externalId: 'default',
      config: {
        scopes: ['chat:write', 'im:write', 'users:read', 'users:read.email'],
        slackTeamId: 'T0123',
      },
    });
    expect(hasSlackBotToken(savedIntegration?.credentials)).toBe(true);
    expect(JSON.stringify(savedIntegration?.credentials)).not.toContain('xoxb-test');
    expect(
      decryptSlackBotToken(savedIntegration?.credentials, {
        organizationId: workspace.organizationId,
        integrationId: savedIntegration?.id ?? '',
      }),
    ).toBe('xoxb-test');
    expect(
      mappings
        .map((mapping) => ({ userId: mapping.userId, slackUserId: mapping.slackUserId }))
        .sort((left, right) => left.userId.localeCompare(right.userId)),
    ).toEqual(
      [
        { userId: workspace.adminUser.id, slackUserId: 'U0123' },
        { userId: teammate.user.id, slackUserId: 'U0456' },
      ].sort((left, right) => left.userId.localeCompare(right.userId)),
    );
  });

  it('surfaces a directory sync failure while keeping the installation connected', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    await expect(complete()).rejects.toThrow(/internal_error/);

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

  it('clears stale mappings after a complete directory has no match', async () => {
    await mapConnectingUser();
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        members: [],
        response_metadata: { next_cursor: '' },
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

  it('retains the previous mapping snapshot when the Slack directory request fails', async () => {
    await mapConnectingUser();
    globalThis.fetch = Object.assign(
      (..._args: Parameters<typeof globalThis.fetch>) =>
        Promise.reject(new Error('Slack directory unavailable')),
      { preconnect: globalThis.fetch.preconnect },
    ) satisfies typeof globalThis.fetch;

    await expect(complete()).rejects.toThrow('Slack directory unavailable');

    const mappings = await db
      .select()
      .from(schema.slackUserMapping)
      .where(eq(schema.slackUserMapping.organizationId, workspace.organizationId));
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      userId: workspace.adminUser.id,
      slackUserId: 'U0123',
    });
    expect(await slackDmAvailable(db, workspace.organizationId, workspace.adminUser.id)).toBe(true);
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
    expect(savedIntegration).toMatchObject({ config: { slackTeamId: 'T0123' } });
    expect(
      decryptSlackBotToken(savedIntegration?.credentials, {
        organizationId: workspace.organizationId,
        integrationId: savedIntegration?.id ?? '',
      }),
    ).toBe('xoxb-test');
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
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        members: [],
        response_metadata: { next_cursor: '' },
      })) as unknown as typeof globalThis.fetch;

    await complete();

    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(integrations).toHaveLength(1);
    expect(integrations[0]).toMatchObject({
      id: legacy?.id,
      externalId: 'default',
      config: {
        scopes: ['chat:write', 'im:write', 'users:read', 'users:read.email'],
        slackTeamId: 'T0123',
      },
    });
    expect(JSON.stringify(integrations[0]?.credentials)).not.toContain('xoxb-test');
    expect(
      decryptSlackBotToken(integrations[0]?.credentials, {
        organizationId: workspace.organizationId,
        integrationId: integrations[0]?.id ?? '',
      }),
    ).toBe('xoxb-test');
  });

  it('does not persist a stale mapping from an older same-team OAuth install', async () => {
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
          members: [
            {
              id: 'U-old-team',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Ada Admin',
              profile: { email: workspace.adminUser.email, display_name: 'Ada' },
            },
          ],
          response_metadata: { next_cursor: '' },
        });
      }
      return Response.json({
        ok: true,
        members: [
          {
            id: 'U-new-team',
            deleted: false,
            is_bot: false,
            is_app_user: false,
            real_name: 'Grace Admin',
            profile: { email: newerAdmin.user.email, display_name: 'Grace' },
          },
        ],
        response_metadata: { next_cursor: '' },
      });
    }) as unknown as typeof globalThis.fetch;

    const olderInstall = completeSlackInstall({
      organizationId: workspace.organizationId,
      userId: workspace.adminUser.id,
      code: 'old-code',
      redirectUri: 'https://orbit.test/api/integrations/slack/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: teamOAuthFetch('T-same', 'xoxb-old-team'),
    });
    await oldLookupStarted.promise;
    await completeSlackInstall({
      organizationId: workspace.organizationId,
      userId: newerAdmin.user.id,
      code: 'new-code',
      redirectUri: 'https://orbit.test/api/integrations/slack/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: teamOAuthFetch('T-same', 'xoxb-new-team'),
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
      config: { slackTeamId: 'T-same' },
    });
    expect(
      decryptSlackBotToken(integrations[0]?.credentials, {
        organizationId: workspace.organizationId,
        integrationId: integrations[0]?.id ?? '',
      }),
    ).toBe('xoxb-new-team');
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

    let providerCalls = 0;
    const provider = (() => {
      providerCalls += 1;
      return Promise.resolve(Response.json({ ok: false, error: 'must_not_exchange' }));
    }) as unknown as typeof globalThis.fetch;
    let rejected = false;
    try {
      await complete(provider);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(providerCalls).toBe(0);

    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(integrations).toHaveLength(0);
  });

  it('rechecks installation authority after the provider exchange', async () => {
    const provider = (async () => {
      await db
        .update(schema.member)
        .set({ role: 'member' })
        .where(
          and(
            eq(schema.member.organizationId, workspace.organizationId),
            eq(schema.member.userId, workspace.adminUser.id),
          ),
        );
      return Response.json({
        ok: true,
        access_token: 'xoxb-authority-changed',
        team: { id: 'T-AUTHORITY', name: 'Authority' },
        scope: 'chat:write,im:write',
      });
    }) as unknown as typeof globalThis.fetch;

    await expect(complete(provider)).rejects.toMatchObject({ code: 'forbidden' });
    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(integrations).toEqual([]);
  });

  it('rejects a deleting workspace before the provider exchange', async () => {
    await db
      .update(schema.organization)
      .set({ deletionRequestedAt: new Date() })
      .where(eq(schema.organization.id, workspace.organizationId));
    let providerCalls = 0;
    const provider = (() => {
      providerCalls += 1;
      return Promise.resolve(Response.json({ ok: false, error: 'must_not_exchange' }));
    }) as unknown as typeof globalThis.fetch;

    await expect(complete(provider)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'workspace_unavailable' },
    });
    expect(providerCalls).toBe(0);
  });

  it('rejects a Slack team claimed by another Orbit workspace', async () => {
    const other = await createWorkspace('slack-team-owner');
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        members: [],
        response_metadata: { next_cursor: '' },
      })) as unknown as typeof globalThis.fetch;
    await completeSlackInstall({
      organizationId: other.organizationId,
      userId: other.adminUser.id,
      code: 'owner-code',
      redirectUri: 'https://orbit.test/api/integrations/slack/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: teamOAuthFetch('T-CLAIMED', 'xoxb-owner'),
    });

    await expect(complete(teamOAuthFetch('T-CLAIMED', 'xoxb-contender'))).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'slack_team_claimed' },
    });
    const integrations = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, workspace.organizationId));
    expect(integrations).toEqual([]);
  });

  it('translates a concurrent cross-workspace team claim collision', async () => {
    const other = await createWorkspace('slack-concurrent-owner');
    await db.execute(
      sql.raw(`
        create or replace function orbit_test_delay_slack_team_claim()
        returns trigger language plpgsql as $function$
        begin
          if new.provider = 'slack' then
            perform pg_sleep(0.25);
          end if;
          return new;
        end
        $function$
      `),
    );
    await db.execute(
      sql.raw(`
        create trigger orbit_test_delay_slack_team_claim
        before insert on integration
        for each row execute function orbit_test_delay_slack_team_claim()
      `),
    );

    try {
      const results = await Promise.allSettled([
        ensureSlackIntegration(db, {
          organizationId: workspace.organizationId,
          connectedById: workspace.adminUser.id,
          botToken: 'xoxb-concurrent-one',
          externalId: 'T-CONCURRENT-CLAIM',
        }),
        ensureSlackIntegration(db, {
          organizationId: other.organizationId,
          connectedById: other.adminUser.id,
          botToken: 'xoxb-concurrent-two',
          externalId: 'T-CONCURRENT-CLAIM',
        }),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        code: 'conflict',
        details: { reason: 'slack_team_claimed' },
      });
      const claimed = await db
        .select({ organizationId: schema.integration.organizationId })
        .from(schema.integration)
        .where(eq(schema.integration.provider, 'slack'));
      expect(claimed).toHaveLength(1);
    } finally {
      await db.execute(
        sql.raw('drop trigger if exists orbit_test_delay_slack_team_claim on integration'),
      );
      await db.execute(sql.raw('drop function if exists orbit_test_delay_slack_team_claim()'));
    }
  });
});
