import { afterAll, describe, expect, it, setSystemTime } from 'bun:test';
import {
  integration,
  issue,
  member,
  organization,
  slackChannelSync,
  slackUserMapping,
  team,
  user,
  workflowState,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq } from 'drizzle-orm';
import { markSlackReauthorizationRequired } from '../../src/notifications/index.ts';
import { decryptSlackBotToken, encryptSlackBotToken } from '../../src/slack/credentials.ts';
import {
  connectSlackChannel,
  disconnectSlackChannel,
  dispatchSlackDm,
  dispatchSlackMessage,
  ensureSlackIntegration,
  ensureSlackIntegrationWithVersion,
  issueIdentifierFromUrl,
  resolveIssueUnfurls,
  resolveSlackContext,
  resolveSlackTargets,
  sendSlackUnfurls,
  slackDmAvailable,
  slackUserMappingSyncReady,
  syncSlackUserMappings,
  upsertSlackUserMapping,
} from '../../src/slack/dispatch.ts';
import { type TestTransaction, testDb, withRollback } from '../../src/test-database.ts';

const originalAuthSecret = process.env['BETTER_AUTH_SECRET'];
process.env['BETTER_AUTH_SECRET'] ??= 'slack-dispatch-test-secret';

afterAll(() => {
  if (originalAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
  else process.env['BETTER_AUTH_SECRET'] = originalAuthSecret;
});

interface Fixture {
  readonly organizationId: string;
  readonly integrationId: string;
  readonly userId: string;
  readonly teamA: string;
  readonly teamB: string;
}

interface WorkspaceOptions {
  readonly name: string;
  readonly slackTeamId?: string;
  readonly botToken?: string;
  readonly connectGithubFirst?: boolean;
}

async function seedWorkspace(tx: TestTransaction, options: WorkspaceOptions): Promise<Fixture> {
  const suffix = randomUUIDv7();
  const slug = options.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const organizationId = `org_${suffix}`;
  await tx
    .insert(organization)
    .values({ id: organizationId, name: options.name, slug: `${slug}-${suffix.toLowerCase()}` });
  const userId = `usr_${suffix}`;
  await tx.insert(user).values({
    id: userId,
    name: 'Ada',
    email: `ada.${suffix}@orbit.local`,
    handle: `ada-${suffix.toLowerCase()}`,
  });
  await tx.insert(member).values({
    id: `mem_${suffix}`,
    organizationId,
    userId,
    role: 'admin',
  });

  const teamA = `team_a_${suffix}`;
  const teamB = `team_b_${suffix}`;
  await tx.insert(team).values([
    { id: teamA, organizationId, name: 'Engineering', key: 'ENG' },
    { id: teamB, organizationId, name: 'Design', key: 'DES' },
  ]);

  if (options.connectGithubFirst === true) {
    await tx.insert(integration).values({
      id: `int_gh_${suffix}`,
      organizationId,
      provider: 'github',
      externalId: `gh-${suffix}`,
      connectedById: userId,
      credentials: { accessToken: 'gho-not-a-slack-token' },
    });
  }

  const integrationId = `int_${suffix}`;
  if (options.botToken !== undefined) {
    await tx.insert(integration).values({
      id: integrationId,
      organizationId,
      provider: 'slack',
      externalId: options.slackTeamId ?? 'T123',
      connectedById: userId,
      credentials: { botToken: options.botToken },
    });
  }

  return { organizationId, integrationId, userId, teamA, teamB };
}

async function seed(tx: TestTransaction): Promise<Fixture> {
  return await seedWorkspace(tx, {
    name: 'Acme',
    slackTeamId: 'default',
    botToken: 'xoxb-test',
  });
}

describe('resolveSlackContext', () => {
  it('reads the bot token from integration credentials', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const context = await resolveSlackContext(tx, fixture.organizationId);
      expect(context?.token).toBe('xoxb-test');
    });
  });

  it('persists Slack scopes and exposes whether direct messages are authorized', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({ config: { scopes: ['chat:write', 'im:write'] } })
        .where(eq(integration.id, fixture.integrationId));

      const context = await resolveSlackContext(tx, fixture.organizationId);
      expect(context?.scopes).toEqual(['chat:write', 'im:write']);
      expect(context?.hasDirectMessageScope).toBe(true);
    });
  });

  it('requires both Slack direct-message scopes', async () => {
    for (const scopes of [['im:write'], ['chat:write']] as const) {
      await withRollback(async (tx) => {
        const fixture = await seed(tx);
        await tx
          .update(integration)
          .set({ config: { scopes: [...scopes] } })
          .where(eq(integration.id, fixture.integrationId));

        const context = await resolveSlackContext(tx, fixture.organizationId);
        expect(context?.hasDirectMessageScope).toBe(false);
      });
    }
  });
});

describe('slackUserMappingSyncReady', () => {
  const readyContext = {
    integrationId: 'int-ready',
    integrationVersion: 'version-ready',
    token: 'xoxb-ready',
    scopes: ['users:read', 'users:read.email'],
    hasDirectMessageScope: false,
    reauthorize: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('accepts a usable Slack directory context', () => {
    expect(slackUserMappingSyncReady({ context: readyContext, slackTeamId: 'T-WORKSPACE' })).toBe(
      true,
    );
  });

  for (const readinessCase of [
    { name: 'missing context', context: null, slackTeamId: 'T-WORKSPACE' },
    {
      name: 'missing token',
      context: { ...readyContext, token: null },
      slackTeamId: 'T-WORKSPACE',
    },
    {
      name: 'reauthorization required',
      context: { ...readyContext, reauthorize: true },
      slackTeamId: 'T-WORKSPACE',
    },
    { name: 'missing team id', context: readyContext, slackTeamId: undefined },
    { name: 'empty team id', context: readyContext, slackTeamId: '' },
    {
      name: 'missing users read scope',
      context: { ...readyContext, scopes: ['users:read.email'] },
      slackTeamId: 'T-WORKSPACE',
    },
    {
      name: 'missing users email scope',
      context: { ...readyContext, scopes: ['users:read'] },
      slackTeamId: 'T-WORKSPACE',
    },
  ]) {
    it(`rejects ${readinessCase.name}`, () => {
      expect(
        slackUserMappingSyncReady({
          context: readinessCase.context,
          slackTeamId: readinessCase.slackTeamId,
        }),
      ).toBe(false);
    });
  }
});

describe('ensureSlackIntegration', () => {
  it('uses distinct credential versions for reconnects in the same millisecond', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'SameMillisecond',
        slackTeamId: 'T-same-millisecond',
        botToken: 'xoxb-old',
      });
      const fixedTime = new Date('2026-08-30T12:00:00.000Z');
      setSystemTime(fixedTime);
      try {
        const older = await ensureSlackIntegrationWithVersion(tx, {
          organizationId: fixture.organizationId,
          connectedById: fixture.userId,
          botToken: 'xoxb-older',
          externalId: 'T-same-millisecond',
        });
        const newer = await ensureSlackIntegrationWithVersion(tx, {
          organizationId: fixture.organizationId,
          connectedById: fixture.userId,
          botToken: 'xoxb-newer',
          externalId: 'T-same-millisecond',
        });

        expect(older.integrationVersion).not.toBe(newer.integrationVersion);
        expect(
          await markSlackReauthorizationRequired(
            tx,
            fixture.organizationId,
            fixture.integrationId,
            older.integrationVersion,
          ),
        ).toBe(false);
        expect(
          await markSlackReauthorizationRequired(
            tx,
            fixture.organizationId,
            fixture.integrationId,
            newer.integrationVersion,
          ),
        ).toBe(true);
      } finally {
        setSystemTime();
      }
    });
  });

  it('reuses a legacy default integration when reconnecting with a team id', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, { name: 'Legacy', botToken: 'xoxb-old' });
      const [legacy] = await tx
        .update(integration)
        .set({ externalId: 'default' })
        .where(eq(integration.id, fixture.integrationId))
        .returning({ id: integration.id });

      const integrationId = await ensureSlackIntegration(tx, {
        organizationId: fixture.organizationId,
        connectedById: fixture.userId,
        botToken: 'xoxb-new',
        externalId: 'T0123',
        scopes: ['im:write'],
      });
      const rows = await tx
        .select({
          externalId: integration.externalId,
          config: integration.config,
          credentials: integration.credentials,
        })
        .from(integration)
        .where(eq(integration.organizationId, fixture.organizationId));

      expect(legacy).toBeDefined();
      if (legacy === undefined) throw new Error('Expected the existing integration row.');
      expect(integrationId).toBe(legacy.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        externalId: 'default',
        config: { slackTeamId: 'T0123', scopes: ['im:write'] },
      });
      expect(JSON.stringify(rows[0]?.credentials)).not.toContain('xoxb-new');
      expect(
        decryptSlackBotToken(rows[0]?.credentials, {
          organizationId: fixture.organizationId,
          integrationId,
        }),
      ).toBe('xoxb-new');
    });
  });

  it('clears Slack user and channel bindings when the connected team changes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'TeamChange',
        slackTeamId: 'T-old',
        botToken: 'xoxb-old',
      });
      await tx
        .update(integration)
        .set({
          externalId: 'default',
          config: { scopes: ['chat:write', 'im:write'] },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-old',
        slackDisplayName: 'Old Slack identity',
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-old',
        channelName: 'old-channel',
        teamId: fixture.teamA,
      });

      await ensureSlackIntegration(tx, {
        organizationId: fixture.organizationId,
        connectedById: fixture.userId,
        botToken: 'xoxb-new',
        externalId: 'T-new',
        scopes: ['chat:write', 'im:write'],
      });

      expect(
        await tx
          .select()
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([]);
      expect(
        await tx
          .select()
          .from(slackChannelSync)
          .where(eq(slackChannelSync.integrationId, fixture.integrationId)),
      ).toEqual([]);
      expect(
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'Do not send this to the old Slack identity',
        }),
      ).toBe(0);
      expect(await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA])).toEqual([]);
    });
  });

  it('consolidates a lone team-keyed legacy integration into the default row', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'LegacyTeamKey',
        slackTeamId: 'T-legacy',
        botToken: 'xoxb-old',
      });
      const reconnectingUserId = `usr_${randomUUIDv7()}`;
      await tx.insert(user).values({
        id: reconnectingUserId,
        name: 'Grace',
        email: `${reconnectingUserId}@orbit.local`,
        handle: reconnectingUserId.toLowerCase(),
      });
      await tx.insert(member).values({
        id: `mem_${randomUUIDv7()}`,
        organizationId: fixture.organizationId,
        userId: reconnectingUserId,
        role: 'admin',
      });
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-legacy',
        slackDisplayName: 'Legacy Slack identity',
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-legacy',
        channelName: 'legacy-channel',
        teamId: fixture.teamA,
      });

      const integrationId = await ensureSlackIntegration(tx, {
        organizationId: fixture.organizationId,
        connectedById: reconnectingUserId,
        botToken: 'xoxb-new',
        externalId: 'T-legacy',
        scopes: ['chat:write'],
      });

      const rows = await tx
        .select()
        .from(integration)
        .where(eq(integration.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: fixture.integrationId,
        externalId: 'default',
        connectedById: reconnectingUserId,
        config: { slackTeamId: 'T-legacy', scopes: ['chat:write'] },
      });
      expect(JSON.stringify(rows[0]?.credentials)).not.toContain('xoxb-new');
      expect(
        decryptSlackBotToken(rows[0]?.credentials, {
          organizationId: fixture.organizationId,
          integrationId,
        }),
      ).toBe('xoxb-new');
      expect(integrationId).toBe(fixture.integrationId);
      expect(
        await tx
          .select()
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toHaveLength(1);
      expect(
        await tx
          .select()
          .from(slackChannelSync)
          .where(eq(slackChannelSync.integrationId, fixture.integrationId)),
      ).toHaveLength(1);
    });
  });

  it('fails closed when more than one Slack integration already exists', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'AmbiguousSlack',
        slackTeamId: 'T-legacy',
        botToken: 'xoxb-legacy',
      });
      await tx.insert(integration).values({
        id: `int_${randomUUIDv7()}`,
        organizationId: fixture.organizationId,
        provider: 'slack',
        externalId: 'default',
        connectedById: fixture.userId,
        credentials: { botToken: 'xoxb-default' },
      });

      await expect(
        ensureSlackIntegration(tx, {
          organizationId: fixture.organizationId,
          connectedById: fixture.userId,
          botToken: 'xoxb-new',
          externalId: 'T-new',
        }),
      ).rejects.toThrow(/multiple Slack integrations/i);

      const rows = await tx
        .select({ credentials: integration.credentials })
        .from(integration)
        .where(eq(integration.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.credentials)).not.toContainEqual({ botToken: 'xoxb-new' });
    });
  });

  it('preserves Slack user and channel bindings for same-team reauthorization', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'SameTeam',
        slackTeamId: 'T-same',
        botToken: 'xoxb-old',
      });
      await tx
        .update(integration)
        .set({ externalId: 'default', config: { slackTeamId: 'T-same' } })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-same',
        slackDisplayName: 'Same Slack identity',
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-same',
        channelName: 'same-channel',
        teamId: fixture.teamA,
      });

      await ensureSlackIntegration(tx, {
        organizationId: fixture.organizationId,
        connectedById: fixture.userId,
        botToken: 'xoxb-new',
        externalId: 'T-same',
      });

      expect(
        await tx
          .select()
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toHaveLength(1);
      expect(
        await tx
          .select()
          .from(slackChannelSync)
          .where(eq(slackChannelSync.integrationId, fixture.integrationId)),
      ).toHaveLength(1);
    });
  });
});

describe('resolveSlackContext stays inside the workspace it was asked about', () => {
  it('does not mark a refreshed integration from a stale provider failure', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'T-acme',
        botToken: 'xoxb-acme',
      });
      const stale = await resolveSlackContext(tx, fixture.organizationId);
      if (stale === null) throw new Error('Expected a Slack context.');
      await tx
        .update(integration)
        .set({
          credentials: { botToken: 'xoxb-refreshed' },
          updatedAt: new Date(stale.updatedAt.getTime() + 1_000),
        })
        .where(eq(integration.id, fixture.integrationId));
      expect(
        await markSlackReauthorizationRequired(
          tx,
          fixture.organizationId,
          fixture.integrationId,
          stale.integrationVersion,
        ),
      ).toBe(false);
      const [after] = await tx
        .select({ config: integration.config })
        .from(integration)
        .where(eq(integration.id, fixture.integrationId));
      expect(after?.config['slackReauthorize']).toBeUndefined();
    });
  });

  it('hands each workspace its own integration row and its own bot token', async () => {
    await withRollback(async (tx) => {
      const acme = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'default',
        botToken: 'xoxb-acme',
      });
      const globex = await seedWorkspace(tx, {
        name: 'Globex',
        slackTeamId: 'default',
        botToken: 'xoxb-globex',
      });

      expect(await resolveSlackContext(tx, acme.organizationId)).toEqual({
        integrationId: acme.integrationId,
        integrationVersion: expect.any(String),
        token: 'xoxb-acme',
        scopes: [],
        hasDirectMessageScope: false,
        reauthorize: false,
        updatedAt: expect.any(Date),
      });
      expect(await resolveSlackContext(tx, globex.organizationId)).toEqual({
        integrationId: globex.integrationId,
        integrationVersion: expect.any(String),
        token: 'xoxb-globex',
        scopes: [],
        hasDirectMessageScope: false,
        reauthorize: false,
        updatedAt: expect.any(Date),
      });
    });
  });

  it('finds no slack context in a workspace that only connected another provider', async () => {
    await withRollback(async (tx) => {
      await seedWorkspace(tx, { name: 'Acme', slackTeamId: 'T-acme', botToken: 'xoxb-acme' });
      const githubOnly = await seedWorkspace(tx, {
        name: 'Initech',
        connectGithubFirst: true,
      });

      expect(await resolveSlackContext(tx, githubOnly.organizationId)).toBeNull();
    });
  });

  it('reads past an older integration from another provider in the same workspace', async () => {
    await withRollback(async (tx) => {
      const acme = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'T-acme',
        botToken: 'xoxb-acme',
        connectGithubFirst: true,
      });

      expect(await resolveSlackContext(tx, acme.organizationId)).toEqual({
        integrationId: acme.integrationId,
        integrationVersion: expect.any(String),
        token: 'xoxb-acme',
        scopes: [],
        hasDirectMessageScope: false,
        reauthorize: false,
        updatedAt: expect.any(Date),
      });
    });
  });
});

describe('syncSlackUserMappings', () => {
  it('waits for member removal before replacing the mapping snapshot', async () => {
    const fixture = await testDb.transaction(async (tx) => await seed(tx));
    const teammateId = `usr_${randomUUIDv7()}`;
    const teammateMemberId = `mem_${randomUUIDv7()}`;
    let releaseRemoval: () => void = () => undefined;
    const removalRelease = new Promise<void>((resolve) => {
      releaseRemoval = resolve;
    });
    let announceRemoval: () => void = () => undefined;
    const removalReady = new Promise<void>((resolve) => {
      announceRemoval = resolve;
    });
    let removal: Promise<void> | undefined;
    let sync: ReturnType<typeof syncSlackUserMappings> | undefined;
    try {
      await testDb
        .update(integration)
        .set({
          config: {
            credentialVersion: 'member-removal-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const teammateEmail = `teammate.${randomUUIDv7()}@orbit.local`;
      await testDb.insert(user).values({
        id: teammateId,
        name: 'Teammate',
        email: teammateEmail,
        handle: `teammate-${randomUUIDv7().toLowerCase()}`,
      });
      await testDb.insert(member).values({
        id: teammateMemberId,
        organizationId: fixture.organizationId,
        userId: teammateId,
        role: 'member',
      });
      await upsertSlackUserMapping(testDb, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: teammateId,
        slackUserId: 'U-TEAMMATE',
        slackDisplayName: 'Teammate',
      });
      removal = testDb.transaction(async (tx) => {
        await tx
          .select({ id: member.id })
          .from(member)
          .where(eq(member.id, teammateMemberId))
          .for('update');
        announceRemoval();
        await removalRelease;
        await tx
          .delete(slackUserMapping)
          .where(
            and(
              eq(slackUserMapping.organizationId, fixture.organizationId),
              eq(slackUserMapping.userId, teammateId),
            ),
          );
        await tx.delete(member).where(eq(member.id, teammateMemberId));
      });
      await removalReady;
      const fetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U-TEAMMATE',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'Teammate',
                profile: { email: teammateEmail, display_name: 'Teammate' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;
      sync = syncSlackUserMappings(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        fetch,
      });
      expect(
        await Promise.race([
          sync.then(
            () => 'settled' as const,
            () => 'settled' as const,
          ),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 500)),
        ]),
      ).toBe('blocked');

      releaseRemoval();
      await removal;
      await expect(sync).resolves.toEqual({
        status: 'applied',
        eligibleMembers: 1,
        mappedMembers: 0,
      });
      expect(
        await testDb
          .select({ id: slackUserMapping.id })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.userId, teammateId)),
      ).toEqual([]);
    } finally {
      releaseRemoval();
      await removal?.catch(() => undefined);
      await sync?.catch(() => undefined);
      await testDb.delete(organization).where(eq(organization.id, fixture.organizationId));
      await testDb.delete(user).where(eq(user.id, fixture.userId));
      await testDb.delete(user).where(eq(user.id, teammateId));
    }
  });

  it('maps every current workspace member and removes mappings for former members', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'sync-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const [admin] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, fixture.userId));
      if (admin === undefined) throw new Error('Expected the workspace administrator.');
      const teammateId = `usr_${randomUUIDv7()}`;
      await tx.insert(user).values({
        id: teammateId,
        name: 'Grace',
        email: `grace.${randomUUIDv7()}@orbit.local`,
        handle: `grace-${randomUUIDv7().toLowerCase()}`,
      });
      await tx.insert(member).values({
        id: `mem_${randomUUIDv7()}`,
        organizationId: fixture.organizationId,
        userId: teammateId,
        role: 'member',
      });
      const [teammate] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, teammateId));
      if (teammate === undefined) throw new Error('Expected the workspace teammate.');
      const formerUserId = `usr_${randomUUIDv7()}`;
      await tx.insert(user).values({
        id: formerUserId,
        name: 'Former',
        email: `former.${randomUUIDv7()}@orbit.local`,
        handle: `former-${randomUUIDv7().toLowerCase()}`,
      });
      const adminMappingId = `sum_${randomUUIDv7()}`;
      const teammateMappingId = `sum_${randomUUIDv7()}`;
      await tx.insert(slackUserMapping).values([
        {
          id: adminMappingId,
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          userId: fixture.userId,
          slackUserId: 'U-ADMIN',
          slackDisplayName: 'Ada',
          slackChannelId: 'D-ADMIN',
        },
        {
          id: teammateMappingId,
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          userId: teammateId,
          slackUserId: 'U-GRACE-OLD',
          slackDisplayName: 'Grace Old',
          slackChannelId: 'D-GRACE-OLD',
        },
        {
          id: `sum_${randomUUIDv7()}`,
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          userId: formerUserId,
          slackUserId: 'U-FORMER',
          slackDisplayName: 'Former',
        },
      ]);
      const fetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U-ADMIN',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'Ada',
                profile: { email: admin.email.toUpperCase(), display_name: 'Ada' },
              },
              {
                id: 'U-GRACE',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'Grace',
                profile: { email: teammate.email, display_name: 'Grace' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).resolves.toEqual({ status: 'applied', eligibleMembers: 2, mappedMembers: 2 });
      const mappings = await tx
        .select({
          id: slackUserMapping.id,
          userId: slackUserMapping.userId,
          slackUserId: slackUserMapping.slackUserId,
          slackChannelId: slackUserMapping.slackChannelId,
        })
        .from(slackUserMapping)
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      expect(mappings.sort((left, right) => left.userId.localeCompare(right.userId))).toEqual(
        [
          {
            id: adminMappingId,
            userId: fixture.userId,
            slackUserId: 'U-ADMIN',
            slackChannelId: 'D-ADMIN',
          },
          {
            id: expect.not.stringContaining(teammateMappingId),
            userId: teammateId,
            slackUserId: 'U-GRACE',
            slackChannelId: null,
          },
        ].sort((left, right) => left.userId.localeCompare(right.userId)),
      );
    });
  });

  it('maps a directory larger than PostgreSQL can bind in one insert', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'batch-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const teammates = Array.from({ length: 7300 }, (_, index) => {
        const suffix = randomUUIDv7();
        return {
          id: `usr_${suffix}`,
          name: `Member ${index}`,
          email: `batch.${index}.${suffix}@orbit.local`,
          handle: `batch-${index}-${suffix.toLowerCase()}`,
        };
      });
      await tx.insert(user).values(teammates);
      await tx.insert(member).values(
        teammates.map((teammate) => ({
          id: `mem_${randomUUIDv7()}`,
          organizationId: fixture.organizationId,
          userId: teammate.id,
          role: 'member' as const,
        })),
      );
      const [admin] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, fixture.userId));
      if (admin === undefined) throw new Error('Expected the workspace administrator.');
      const directory = [
        { id: 'U-BATCH-ADMIN', email: admin.email, displayName: 'Admin' },
        ...teammates.map((teammate, index) => ({
          id: `U-BATCH-${index}`,
          email: teammate.email,
          displayName: teammate.name,
        })),
      ];
      const fetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: directory.map((entry) => ({
              id: entry.id,
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: entry.displayName,
              profile: { email: entry.email, display_name: entry.displayName },
            })),
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).resolves.toEqual({ status: 'applied', eligibleMembers: 7301, mappedMembers: 7301 });
      const mappings = await tx
        .select({ id: slackUserMapping.id })
        .from(slackUserMapping)
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      expect(mappings).toHaveLength(7301);
    });
  });

  it('rolls back the old mapping snapshot when a replacement insert fails', async () => {
    const fixture = await testDb.transaction(async (tx) => await seed(tx));
    try {
      await testDb
        .update(integration)
        .set({
          config: {
            credentialVersion: 'rollback-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const teammateId = `usr_${randomUUIDv7()}`;
      const teammateEmail = `rollback.${randomUUIDv7()}@orbit.local`;
      await testDb.insert(user).values({
        id: teammateId,
        name: 'Rollback Member',
        email: teammateEmail,
        handle: `rollback-${randomUUIDv7().toLowerCase()}`,
      });
      await testDb.insert(member).values({
        id: `mem_${randomUUIDv7()}`,
        organizationId: fixture.organizationId,
        userId: teammateId,
        role: 'member',
      });
      const [admin] = await testDb
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, fixture.userId));
      if (admin === undefined) throw new Error('Expected the workspace administrator.');
      const oldMappingId = `sum_${randomUUIDv7()}`;
      await testDb.insert(slackUserMapping).values({
        id: oldMappingId,
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-OLD',
        slackDisplayName: 'Old',
        slackChannelId: 'D-OLD',
      });
      const fetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: [admin.email, teammateEmail].map((email) => ({
              id: 'U-DUPLICATE',
              deleted: false,
              is_bot: false,
              is_app_user: false,
              real_name: 'Duplicate',
              profile: { email, display_name: 'Duplicate' },
            })),
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(testDb, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).rejects.toThrow('insert into "slack_user_mapping"');
      expect(
        await testDb
          .select({
            id: slackUserMapping.id,
            slackUserId: slackUserMapping.slackUserId,
            slackChannelId: slackUserMapping.slackChannelId,
          })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([{ id: oldMappingId, slackUserId: 'U-OLD', slackChannelId: 'D-OLD' }]);
    } finally {
      await testDb.delete(organization).where(eq(organization.id, fixture.organizationId));
    }
  });

  it('keeps every prior mapping when a later Slack directory page is incomplete', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'stable-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-STABLE',
        slackDisplayName: 'Stable',
      });
      await tx
        .update(slackUserMapping)
        .set({ slackChannelId: 'D-STABLE' })
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      const [admin] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, fixture.userId));
      if (admin === undefined) throw new Error('Expected the workspace administrator.');
      let calls = 0;
      const fetch = (() => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            Response.json({
              ok: true,
              members: [
                {
                  id: 'U-REPLACEMENT',
                  deleted: false,
                  is_bot: false,
                  is_app_user: false,
                  real_name: 'Replacement',
                  profile: { email: admin.email, display_name: 'Replacement' },
                },
              ],
              response_metadata: { next_cursor: 'page-two' },
            }),
          );
        }
        return Promise.resolve(Response.json({ ok: true, members: [] }));
      }) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).rejects.toThrow('unexpected payload');
      expect(
        await tx
          .select({
            userId: slackUserMapping.userId,
            slackUserId: slackUserMapping.slackUserId,
            slackChannelId: slackUserMapping.slackChannelId,
          })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([{ userId: fixture.userId, slackUserId: 'U-STABLE', slackChannelId: 'D-STABLE' }]);
    });
  });

  it('marks the observed integration for reauthorization when its token expires', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'expired-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const fetch = (() =>
        Promise.resolve(
          Response.json({ ok: false, error: 'token_expired' }),
        )) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).rejects.toMatchObject({ code: 'token_expired' });
      const [stored] = await tx
        .select({ config: integration.config })
        .from(integration)
        .where(eq(integration.id, fixture.integrationId));
      expect(stored?.config['slackReauthorize']).toBe(true);
    });
  });

  it('does not mark replacement credentials for an error from the previous token', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'previous-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const fetch = (async () => {
        await tx
          .update(integration)
          .set({
            config: {
              credentialVersion: 'replacement-version',
              slackTeamId: 'T-WORKSPACE',
              scopes: ['users:read', 'users:read.email'],
            },
          })
          .where(eq(integration.id, fixture.integrationId));
        return Response.json({ ok: false, error: 'invalid_auth' });
      }) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).rejects.toMatchObject({ code: 'invalid_auth' });
      const [stored] = await tx
        .select({ config: integration.config })
        .from(integration)
        .where(eq(integration.id, fixture.integrationId));
      expect(stored?.config).toMatchObject({ credentialVersion: 'replacement-version' });
      expect(stored?.config['slackReauthorize']).toBeUndefined();
    });
  });

  it('retains prior mappings when reauthorization is marked during directory loading', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'reauthorize-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-STABLE',
        slackDisplayName: 'Stable',
      });
      const fetch = (async () => {
        await markSlackReauthorizationRequired(
          tx,
          fixture.organizationId,
          fixture.integrationId,
          'reauthorize-version',
        );
        return Response.json({
          ok: true,
          members: [],
          response_metadata: { next_cursor: '' },
        });
      }) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).resolves.toEqual({ status: 'stale' });
      expect(
        await tx
          .select({ slackUserId: slackUserMapping.slackUserId })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([{ slackUserId: 'U-STABLE' }]);
    });
  });

  it('rechecks manager authority after loading the Slack directory', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'authority-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-STABLE',
        slackDisplayName: 'Stable',
      });
      const fetch = (async () => {
        await tx.update(member).set({ role: 'member' }).where(eq(member.userId, fixture.userId));
        return Response.json({
          ok: true,
          members: [],
          response_metadata: { next_cursor: '' },
        });
      }) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect(
        await tx
          .select({ slackUserId: slackUserMapping.slackUserId })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([{ slackUserId: 'U-STABLE' }]);
    });
  });

  it('does not apply a directory fetched with an older same-team credential version', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'old-version',
            slackTeamId: 'T-OLD',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-OLD',
        slackDisplayName: 'Old',
      });
      const fetch = (async () => {
        await tx
          .update(integration)
          .set({
            config: {
              credentialVersion: 'new-version',
              slackTeamId: 'T-OLD',
              scopes: ['users:read', 'users:read.email'],
            },
          })
          .where(eq(integration.id, fixture.integrationId));
        return Response.json({
          ok: true,
          members: [],
          response_metadata: { next_cursor: '' },
        });
      }) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).resolves.toEqual({ status: 'stale' });
      expect(
        await tx
          .select({ slackUserId: slackUserMapping.slackUserId })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([{ slackUserId: 'U-OLD' }]);
    });
  });

  it('leaves an ambiguous Orbit email unmapped without changing another workspace', async () => {
    await withRollback(async (tx) => {
      const target = await seed(tx);
      const neighbour = await seedWorkspace(tx, {
        name: 'Neighbour',
        slackTeamId: 'default',
        botToken: 'xoxb-neighbour',
      });
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'target-version',
            slackTeamId: 'T-TARGET',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, target.integrationId));
      const [admin] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, target.userId));
      if (admin === undefined) throw new Error('Expected the target administrator.');
      const collidingUserId = 'usr_000_case_collision';
      await tx.insert(user).values({
        id: collidingUserId,
        name: 'Case Collision',
        email: admin.email.toUpperCase(),
        handle: `case-collision-${randomUUIDv7().toLowerCase()}`,
      });
      await tx.insert(member).values({
        id: `mem_${randomUUIDv7()}`,
        organizationId: target.organizationId,
        userId: collidingUserId,
        role: 'member',
      });
      await upsertSlackUserMapping(tx, {
        organizationId: neighbour.organizationId,
        integrationId: neighbour.integrationId,
        userId: neighbour.userId,
        slackUserId: 'U-NEIGHBOUR',
        slackDisplayName: 'Neighbour',
      });
      const fetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U-A',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'Earlier Identity',
                profile: { email: admin.email.toUpperCase(), display_name: 'Earlier' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: target.organizationId,
          userId: target.userId,
          fetch,
        }),
      ).resolves.toEqual({ status: 'applied', eligibleMembers: 2, mappedMembers: 0 });
      expect(
        await tx
          .select({ userId: slackUserMapping.userId, slackUserId: slackUserMapping.slackUserId })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, target.integrationId)),
      ).toEqual([]);
      expect(
        await tx
          .select({ slackUserId: slackUserMapping.slackUserId })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, neighbour.integrationId)),
      ).toEqual([{ slackUserId: 'U-NEIGHBOUR' }]);
    });
  });

  it('leaves an ambiguous Slack email unmapped', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({
          config: {
            credentialVersion: 'slack-collision-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      const [admin] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, fixture.userId));
      if (admin === undefined) throw new Error('Expected the workspace administrator.');
      const fetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U-A',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'First Identity',
                profile: { email: admin.email, display_name: 'First' },
              },
              {
                id: 'U-B',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'Second Identity',
                profile: { email: admin.email.toUpperCase(), display_name: 'Second' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;

      await expect(
        syncSlackUserMappings(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          fetch,
        }),
      ).resolves.toEqual({ status: 'applied', eligibleMembers: 1, mappedMembers: 0 });
      expect(
        await tx
          .select({ id: slackUserMapping.id })
          .from(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId)),
      ).toEqual([]);
    });
  });
});

describe('resolveSlackTargets keeps a channel inside the workspace it belongs to', () => {
  it('never offers another workspace channel to an issue on this one', async () => {
    await withRollback(async (tx) => {
      const acme = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'default',
        botToken: 'xoxb-acme',
      });
      const globex = await seedWorkspace(tx, {
        name: 'Globex',
        slackTeamId: 'default',
        botToken: 'xoxb-globex',
      });
      await connectSlackChannel(tx, {
        organizationId: globex.organizationId,
        integrationId: globex.integrationId,
        channelId: 'C-globex-all',
        channelName: 'globex-everything',
        teamId: null,
      });
      await connectSlackChannel(tx, {
        organizationId: globex.organizationId,
        integrationId: globex.integrationId,
        channelId: 'C-globex-eng',
        channelName: 'globex-engineering',
        teamId: globex.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: acme.organizationId,
        integrationId: acme.integrationId,
        channelId: 'C-acme-eng',
        channelName: 'acme-engineering',
        teamId: acme.teamA,
      });

      expect(
        (await resolveSlackTargets(tx, acme.organizationId, [acme.teamA])).map(
          (target) => target.channelId,
        ),
      ).toEqual(['C-acme-eng']);
      expect(await resolveSlackTargets(tx, acme.organizationId, [])).toEqual([]);
      expect(
        (await resolveSlackTargets(tx, globex.organizationId, [globex.teamA]))
          .map((target) => target.channelId)
          .sort(),
      ).toEqual(['C-globex-all', 'C-globex-eng']);
    });
  });

  it('never offers another workspace channel bound to a team id it does not know', async () => {
    await withRollback(async (tx) => {
      const acme = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'T-acme',
        botToken: 'xoxb-acme',
      });
      const globex = await seedWorkspace(tx, {
        name: 'Globex',
        slackTeamId: 'T-globex',
        botToken: 'xoxb-globex',
      });
      await connectSlackChannel(tx, {
        organizationId: globex.organizationId,
        integrationId: globex.integrationId,
        channelId: 'C-globex-design',
        channelName: 'globex-design',
        teamId: globex.teamB,
      });

      expect(
        await resolveSlackTargets(tx, acme.organizationId, [acme.teamA, globex.teamB]),
      ).toEqual([]);
    });
  });
});

describe('connectSlackChannel', () => {
  it('keeps one channel per team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C1',
        channelName: 'one',
        teamId: fixture.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C2',
        channelName: 'two',
        teamId: fixture.teamA,
      });
      const rows = await tx
        .select()
        .from(slackChannelSync)
        .where(eq(slackChannelSync.organizationId, fixture.organizationId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.channelId).toBe('C2');
    });
  });

  it('keeps one team per channel', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C9',
        channelName: 'shared',
        teamId: fixture.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C9',
        channelName: 'shared',
        teamId: fixture.teamB,
      });
      const rows = await tx
        .select()
        .from(slackChannelSync)
        .where(eq(slackChannelSync.channelId, 'C9'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.teamId).toBe(fixture.teamB);
    });
  });

  it('resolves and removes targets', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C1',
        channelName: 'eng',
        teamId: fixture.teamA,
      });
      const targets = await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA]);
      expect(targets.map((target) => target.channelId)).toEqual(['C1']);

      const removed = await disconnectSlackChannel(tx, {
        integrationId: fixture.integrationId,
        channelId: 'C1',
      });
      expect(removed).toBe(1);
      expect(await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA])).toHaveLength(
        0,
      );
    });
  });
});

describe('resolveSlackTargets keeps a channel inside the team it is bound to', () => {
  it('never offers a channel bound to another team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-design',
        channelName: 'design-private',
        teamId: fixture.teamB,
      });

      const forEngineering = await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA]);
      const forDesign = await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamB]);

      expect(forEngineering).toHaveLength(0);
      expect(forDesign.map((target) => target.channelId)).toEqual(['C-design']);
    });
  });

  it('offers a channel with no team to every team, and only once', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-all',
        channelName: 'everything',
        teamId: null,
      });

      expect(
        (await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA])).map(
          (target) => target.channelId,
        ),
      ).toEqual(['C-all']);
      expect(
        (await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamB])).map(
          (target) => target.channelId,
        ),
      ).toEqual(['C-all']);
      expect(
        await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA, fixture.teamB]),
      ).toHaveLength(1);
      expect(
        (await resolveSlackTargets(tx, fixture.organizationId, [])).map(
          (target) => target.channelId,
        ),
      ).toEqual(['C-all']);
    });
  });

  it('mixes a workspace wide channel with the asking team own channel', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-all',
        channelName: 'everything',
        teamId: null,
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-eng',
        channelName: 'engineering',
        teamId: fixture.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-design',
        channelName: 'design',
        teamId: fixture.teamB,
      });

      const targets = await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA]);

      expect(targets.map((target) => target.channelId).sort()).toEqual(['C-all', 'C-eng']);
      expect(
        (await resolveSlackTargets(tx, fixture.organizationId, [])).map((t) => t.channelId),
      ).toEqual(['C-all']);
    });
  });

  it('names a channel once even when two integrations bind it to two teams', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const secondIntegration = `${fixture.integrationId}_second`;
      await tx.insert(integration).values({
        id: secondIntegration,
        organizationId: fixture.organizationId,
        provider: 'slack',
        externalId: 'T456',
        connectedById: fixture.userId,
        credentials: { botToken: 'xoxb-second' },
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-shared',
        channelName: 'shared',
        teamId: fixture.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: secondIntegration,
        channelId: 'C-shared',
        channelName: 'shared',
        teamId: fixture.teamB,
      });

      const targets = await resolveSlackTargets(tx, fixture.organizationId, [
        fixture.teamA,
        fixture.teamB,
      ]);

      expect(targets.map((target) => target.channelId)).toEqual(['C-shared']);
    });
  });

  it('skips a channel that was turned off', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-off',
        channelName: 'muted',
        teamId: fixture.teamA,
      });
      await tx
        .update(slackChannelSync)
        .set({ enabled: false })
        .where(eq(slackChannelSync.channelId, 'C-off'));

      expect(await resolveSlackTargets(tx, fixture.organizationId, [fixture.teamA])).toHaveLength(
        0,
      );
    });
  });
});

interface PostLog {
  readonly channels: string[];
  readonly authorizations: string[];
}

function newLog(): PostLog {
  return { channels: [], authorizations: [] };
}

function fetchStub(log: PostLog, failing: readonly string[] = []): typeof globalThis.fetch {
  return ((_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { channel?: string };
    const channel = body.channel ?? '';
    log.channels.push(channel);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    log.authorizations.push(headers['authorization'] ?? '');
    if (failing.includes(channel)) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, channel, ts: '1.0' }), { status: 200 }),
    );
  }) as unknown as typeof globalThis.fetch;
}

describe('dispatchSlackMessage never crosses a workspace boundary', () => {
  it('posts only into the asking workspace channels, with only its own bot token', async () => {
    await withRollback(async (tx) => {
      const acme = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'default',
        botToken: 'xoxb-acme',
      });
      const globex = await seedWorkspace(tx, {
        name: 'Globex',
        slackTeamId: 'default',
        botToken: 'xoxb-globex',
      });
      await connectSlackChannel(tx, {
        organizationId: globex.organizationId,
        integrationId: globex.integrationId,
        channelId: 'C-globex-all',
        channelName: 'globex-everything',
        teamId: null,
      });
      await connectSlackChannel(tx, {
        organizationId: acme.organizationId,
        integrationId: acme.integrationId,
        channelId: 'C-acme-eng',
        channelName: 'acme-engineering',
        teamId: acme.teamA,
      });
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: acme.organizationId,
        teamIds: [acme.teamA],
        text: 'ENG-1 moved',
        fetch: fetchStub(log),
      });

      expect(delivered).toBe(1);
      expect(log.channels).toEqual(['C-acme-eng']);
      expect(log.authorizations).toEqual(['Bearer xoxb-acme']);
    });
  });

  it('signs the other workspace dispatch with the other workspace token', async () => {
    await withRollback(async (tx) => {
      const acme = await seedWorkspace(tx, {
        name: 'Acme',
        slackTeamId: 'default',
        botToken: 'xoxb-acme',
      });
      const globex = await seedWorkspace(tx, {
        name: 'Globex',
        slackTeamId: 'default',
        botToken: 'xoxb-globex',
      });
      await connectSlackChannel(tx, {
        organizationId: globex.organizationId,
        integrationId: globex.integrationId,
        channelId: 'C-globex-eng',
        channelName: 'globex-engineering',
        teamId: globex.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: acme.organizationId,
        integrationId: acme.integrationId,
        channelId: 'C-acme-eng',
        channelName: 'acme-engineering',
        teamId: acme.teamA,
      });
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: globex.organizationId,
        teamIds: [globex.teamA],
        text: 'ENG-1 moved',
        fetch: fetchStub(log),
      });

      expect(delivered).toBe(1);
      expect(log.channels).toEqual(['C-globex-eng']);
      expect(log.authorizations).toEqual(['Bearer xoxb-globex']);
    });
  });
});

describe('dispatchSlackMessage', () => {
  it('skips an optional Slack send when stored credentials use an old key', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-rotated-key',
        channelName: 'rotated-key',
        teamId: fixture.teamA,
      });
      process.env['BETTER_AUTH_SECRET'] = 'slack-broadcast-old-key';
      const envelope = encryptSlackBotToken({
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        token: 'xoxb-encrypted',
      });
      await tx
        .update(integration)
        .set({ credentials: { botToken: envelope } })
        .where(eq(integration.id, fixture.integrationId));
      process.env['BETTER_AUTH_SECRET'] = 'slack-broadcast-rotated-key';
      let providerCalls = 0;
      const fetch = (() => {
        providerCalls += 1;
        return Promise.resolve(Response.json({ ok: true }));
      }) as unknown as typeof globalThis.fetch;

      try {
        expect(
          await dispatchSlackMessage(tx, {
            organizationId: fixture.organizationId,
            teamIds: [fixture.teamA],
            text: 'Optional broadcast',
            fetch,
          }),
        ).toBe(0);
        expect(providerCalls).toBe(0);
      } finally {
        process.env['BETTER_AUTH_SECRET'] = originalAuthSecret ?? 'slack-dispatch-test-secret';
      }
    });
  });

  it('uses only the canonical integration token and channels when a legacy row coexists', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'LegacyBroadcast',
        slackTeamId: 'T-LEGACY',
        botToken: 'xoxb-legacy',
      });
      const canonicalIntegrationId = `int_${randomUUIDv7()}`;
      await tx.insert(integration).values({
        id: canonicalIntegrationId,
        organizationId: fixture.organizationId,
        provider: 'slack',
        externalId: 'default',
        connectedById: fixture.userId,
        credentials: { botToken: 'xoxb-canonical' },
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-LEGACY',
        channelName: 'legacy-private',
        teamId: fixture.teamA,
      });
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: canonicalIntegrationId,
        channelId: 'C-CANONICAL',
        channelName: 'canonical-private',
        teamId: fixture.teamA,
      });
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: fixture.organizationId,
        teamIds: [fixture.teamA],
        text: 'Private workspace update',
        fetch: fetchStub(log),
      });

      expect(delivered).toBe(1);
      expect(log.channels).toEqual(['C-CANONICAL']);
      expect(log.authorizations).toEqual(['Bearer xoxb-canonical']);
    });
  });

  it('posts to every resolved channel and counts what it delivered', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      for (const [channelId, teamId] of [
        ['C-eng', fixture.teamA],
        ['C-all', null],
        ['C-design', fixture.teamB],
      ] as const) {
        await connectSlackChannel(tx, {
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          channelId,
          channelName: channelId,
          teamId,
        });
      }
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: fixture.organizationId,
        teamIds: [fixture.teamA],
        text: 'ENG-1 moved',
        fetch: fetchStub(log),
      });

      expect(delivered).toBe(2);
      expect(log.channels.sort()).toEqual(['C-all', 'C-eng']);
    });
  });

  it('keeps going and still counts the rest when one channel post fails', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      for (const channelId of ['C-eng', 'C-more']) {
        await connectSlackChannel(tx, {
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          channelId,
          channelName: channelId,
          teamId: null,
        });
      }
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: fixture.organizationId,
        teamIds: [fixture.teamA],
        text: 'ENG-1 moved',
        fetch: fetchStub(log, ['C-eng']),
      });

      expect(delivered).toBe(1);
      expect(log.channels.sort()).toEqual(['C-eng', 'C-more']);
    });
  });

  it('posts nothing when the workspace has no slack token', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-eng',
        channelName: 'engineering',
        teamId: fixture.teamA,
      });
      await tx
        .update(integration)
        .set({ credentials: {} })
        .where(eq(integration.id, fixture.integrationId));
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: fixture.organizationId,
        teamIds: [fixture.teamA],
        text: 'ENG-1 moved',
        fetch: fetchStub(log),
      });

      expect(delivered).toBe(0);
      expect(log.channels).toHaveLength(0);
    });
  });

  it('posts nothing when no channel is connected to the asking team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await connectSlackChannel(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        channelId: 'C-design',
        channelName: 'design',
        teamId: fixture.teamB,
      });
      const log = newLog();

      const delivered = await dispatchSlackMessage(tx, {
        organizationId: fixture.organizationId,
        teamIds: [fixture.teamA],
        text: 'ENG-1 moved',
        fetch: fetchStub(log),
      });

      expect(delivered).toBe(0);
      expect(log.channels).toHaveLength(0);
    });
  });
});

describe('sendSlackUnfurls', () => {
  it('does not use reconnected workspace credentials for a stale routed event', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'BoundUnfurl',
        slackTeamId: 'T-A',
        botToken: 'xoxb-team-a',
      });
      await tx
        .update(integration)
        .set({ externalId: 'default', config: { slackTeamId: 'T-A' } })
        .where(eq(integration.id, fixture.integrationId));
      const observed = await resolveSlackContext(tx, fixture.organizationId, 'default');
      if (observed === null) throw new Error('Expected a routed Slack integration.');
      await ensureSlackIntegration(tx, {
        organizationId: fixture.organizationId,
        connectedById: fixture.userId,
        botToken: 'xoxb-team-b',
        externalId: 'T-B',
      });
      let providerCalls = 0;
      const fetch = (() => {
        providerCalls += 1;
        return Promise.resolve(Response.json({ ok: true }));
      }) as unknown as typeof globalThis.fetch;

      expect(
        await sendSlackUnfurls(tx, {
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          slackTeamId: 'T-A',
          integrationVersion: observed.integrationVersion,
          channel: 'C-LINKS',
          ts: '1.0',
          unfurls: { 'https://orbit.local/issue/ORB-1': { blocks: [] } },
          fetch,
        }),
      ).toBe(false);
      expect(providerCalls).toBe(0);
    });
  });
});

describe('dispatchSlackDm', () => {
  it('keeps one credential snapshot for an in-flight private send', async () => {
    const fixture = await testDb.transaction(async (tx) => await seed(tx));
    let releaseConversation: () => void = () => undefined;
    const conversationRelease = new Promise<void>((resolve) => {
      releaseConversation = resolve;
    });
    let announceConversation: () => void = () => undefined;
    const conversationReady = new Promise<void>((resolve) => {
      announceConversation = resolve;
    });
    const fetch = (async (url: string) => {
      if (url.endsWith('conversations.open')) {
        announceConversation();
        await conversationRelease;
        return Response.json({ ok: true, channel: { id: 'D-SNAPSHOT' } });
      }
      return Response.json({ ok: true, channel: 'D-SNAPSHOT', ts: '1.0' });
    }) as unknown as typeof globalThis.fetch;
    let dispatch: Promise<number> | undefined;
    let rotation: Promise<void> | undefined;
    try {
      await testDb
        .update(integration)
        .set({
          config: {
            credentialVersion: 'snapshot-before',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['chat:write', 'im:write'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(testDb, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-SNAPSHOT',
        slackDisplayName: 'Snapshot identity',
      });

      dispatch = dispatchSlackDm(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        text: 'Private notification',
        fetch,
      });
      await Promise.race([conversationReady, dispatch.then(() => undefined)]);
      rotation = testDb.transaction(async (tx) => {
        await tx
          .update(integration)
          .set({
            credentials: { botToken: 'xoxb-snapshot-after' },
            config: {
              credentialVersion: 'snapshot-after',
              slackTeamId: 'T-WORKSPACE',
              scopes: ['chat:write', 'im:write'],
            },
          })
          .where(eq(integration.id, fixture.integrationId));
      });
      expect(
        await Promise.race([
          rotation.then(
            () => 'settled' as const,
            () => 'settled' as const,
          ),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 500)),
        ]),
      ).toBe('blocked');

      releaseConversation();
      await expect(dispatch).resolves.toBe(1);
      await rotation;
      const [current] = await testDb
        .select({ config: integration.config })
        .from(integration)
        .where(eq(integration.id, fixture.integrationId));
      expect(current?.config['credentialVersion']).toBe('snapshot-after');
    } finally {
      releaseConversation();
      await dispatch?.catch(() => undefined);
      await rotation?.catch(() => undefined);
      await testDb.delete(organization).where(eq(organization.id, fixture.organizationId));
      await testDb.delete(user).where(eq(user.id, fixture.userId));
    }
  });

  it('serializes concurrent private sends for the same member mapping', async () => {
    const fixture = await testDb.transaction(async (tx) => await seed(tx));
    let releaseConversation: () => void = () => undefined;
    const conversationRelease = new Promise<void>((resolve) => {
      releaseConversation = resolve;
    });
    let announceConversation: () => void = () => undefined;
    const conversationReady = new Promise<void>((resolve) => {
      announceConversation = resolve;
    });
    const providerCalls: string[] = [];
    const fetch = (async (url: string) => {
      providerCalls.push(url);
      if (url.endsWith('conversations.open')) {
        announceConversation();
        await conversationRelease;
        return Response.json({ ok: true, channel: { id: 'D-SERIAL' } });
      }
      return Response.json({ ok: true, channel: 'D-SERIAL', ts: '1.0' });
    }) as unknown as typeof globalThis.fetch;
    let first: Promise<number> | undefined;
    let second: Promise<number> | undefined;
    try {
      await testDb
        .update(integration)
        .set({
          config: {
            credentialVersion: 'concurrent-dm-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['chat:write', 'im:write'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(testDb, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-SERIAL',
        slackDisplayName: 'Serial identity',
      });

      first = dispatchSlackDm(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        text: 'First private notification',
        fetch,
      });
      await Promise.race([conversationReady, first.then(() => undefined)]);
      second = dispatchSlackDm(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        text: 'Second private notification',
        fetch,
      });
      expect(
        await Promise.race([
          second.then(
            () => 'settled' as const,
            () => 'settled' as const,
          ),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 500)),
        ]),
      ).toBe('blocked');
      expect(providerCalls.filter((url) => url.endsWith('conversations.open'))).toHaveLength(1);

      releaseConversation();
      await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
      expect(providerCalls.filter((url) => url.endsWith('conversations.open'))).toHaveLength(1);
      expect(providerCalls.filter((url) => url.endsWith('chat.postMessage'))).toHaveLength(2);
    } finally {
      releaseConversation();
      await first?.catch(() => undefined);
      await second?.catch(() => undefined);
      await testDb.delete(organization).where(eq(organization.id, fixture.organizationId));
      await testDb.delete(user).where(eq(user.id, fixture.userId));
    }
  });

  it('uses one replacement snapshot when reconnect wins the lock', async () => {
    const fixture = await testDb.transaction(async (tx) => await seed(tx));
    let releaseReplacement: () => void = () => undefined;
    const replacementRelease = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    let announceReplacement: () => void = () => undefined;
    const replacementReady = new Promise<void>((resolve) => {
      announceReplacement = resolve;
    });
    let replacement: Promise<void> | undefined;
    try {
      await testDb
        .update(integration)
        .set({
          config: {
            credentialVersion: 'previous-dm-version',
            slackTeamId: 'T-PREVIOUS',
            scopes: ['chat:write', 'im:write'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(testDb, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-PREVIOUS',
        slackDisplayName: 'Previous identity',
      });
      replacement = testDb.transaction(async (tx) => {
        await tx
          .update(integration)
          .set({
            credentials: { botToken: 'xoxb-replacement' },
            config: {
              credentialVersion: 'replacement-dm-version',
              slackTeamId: 'T-REPLACEMENT',
              scopes: ['chat:write', 'im:write'],
            },
          })
          .where(eq(integration.id, fixture.integrationId));
        await tx
          .delete(slackUserMapping)
          .where(eq(slackUserMapping.integrationId, fixture.integrationId));
        await tx.insert(slackUserMapping).values({
          id: `sum_${randomUUIDv7()}`,
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          userId: fixture.userId,
          slackUserId: 'U-REPLACEMENT',
          slackDisplayName: 'Replacement identity',
        });
        announceReplacement();
        await replacementRelease;
      });
      await replacementReady;
      const providerCalls: { authorization: string; body: Record<string, unknown> }[] = [];
      const fetch = ((url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        providerCalls.push({ authorization: headers['authorization'] ?? '', body });
        const response = url.endsWith('conversations.open')
          ? { ok: true, channel: { id: 'D-REPLACEMENT' } }
          : { ok: true, channel: 'D-REPLACEMENT', ts: '1.0' };
        return Promise.resolve(Response.json(response));
      }) as unknown as typeof globalThis.fetch;
      const delivery = dispatchSlackDm(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        text: 'Private notification',
        fetch,
      });
      expect(
        await Promise.race([
          delivery.then(
            () => 'settled' as const,
            () => 'settled' as const,
          ),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 500)),
        ]),
      ).toBe('blocked');

      releaseReplacement();
      await replacement;
      await expect(delivery).resolves.toBe(1);
      expect(providerCalls).toEqual([
        {
          authorization: 'Bearer xoxb-replacement',
          body: { users: 'U-REPLACEMENT' },
        },
        {
          authorization: 'Bearer xoxb-replacement',
          body: { channel: 'D-REPLACEMENT', text: 'Private notification' },
        },
      ]);
    } finally {
      releaseReplacement();
      await replacement?.catch(() => undefined);
      await testDb.delete(organization).where(eq(organization.id, fixture.organizationId));
      await testDb.delete(user).where(eq(user.id, fixture.userId));
    }
  });

  it('serializes a private send against member remapping', async () => {
    const fixture = await testDb.transaction(async (tx) => await seed(tx));
    let releaseConversation: () => void = () => undefined;
    const conversationRelease = new Promise<void>((resolve) => {
      releaseConversation = resolve;
    });
    let announceConversation: () => void = () => undefined;
    const conversationReady = new Promise<void>((resolve) => {
      announceConversation = resolve;
    });
    let dispatch: Promise<number> | undefined;
    let sync: ReturnType<typeof syncSlackUserMappings> | undefined;
    try {
      await testDb
        .update(integration)
        .set({
          config: {
            credentialVersion: 'dm-race-version',
            slackTeamId: 'T-WORKSPACE',
            scopes: ['chat:write', 'im:write', 'users:read', 'users:read.email'],
          },
        })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(testDb, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-OLD',
        slackDisplayName: 'Old identity',
      });
      const [admin] = await testDb
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, fixture.userId));
      if (admin === undefined) throw new Error('Expected the workspace administrator.');
      const dmFetch = (async (url: string) => {
        if (url.endsWith('conversations.open')) {
          announceConversation();
          await conversationRelease;
          return Response.json({ ok: true, channel: { id: 'D-OLD' } });
        }
        return Response.json({ ok: true, channel: 'D-OLD', ts: '1.0' });
      }) as unknown as typeof globalThis.fetch;
      const directoryFetch = (() =>
        Promise.resolve(
          Response.json({
            ok: true,
            members: [
              {
                id: 'U-NEW',
                deleted: false,
                is_bot: false,
                is_app_user: false,
                real_name: 'New identity',
                profile: { email: admin.email, display_name: 'New identity' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        )) as unknown as typeof globalThis.fetch;

      dispatch = dispatchSlackDm(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        text: 'Private notification',
        fetch: dmFetch,
      });
      await Promise.race([conversationReady, dispatch.then(() => undefined)]);
      sync = syncSlackUserMappings(testDb, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        fetch: directoryFetch,
      });
      expect(
        await Promise.race([
          sync.then(
            () => 'settled' as const,
            () => 'settled' as const,
          ),
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 500)),
        ]),
      ).toBe('blocked');

      releaseConversation();
      await expect(dispatch).resolves.toBe(1);
      await expect(sync).resolves.toEqual({
        status: 'applied',
        eligibleMembers: 1,
        mappedMembers: 1,
      });
      const [mapping] = await testDb
        .select({ slackUserId: slackUserMapping.slackUserId })
        .from(slackUserMapping)
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      expect(mapping?.slackUserId).toBe('U-NEW');
    } finally {
      releaseConversation();
      await dispatch?.catch(() => undefined);
      await sync?.catch(() => undefined);
      await testDb.delete(organization).where(eq(organization.id, fixture.organizationId));
      await testDb.delete(user).where(eq(user.id, fixture.userId));
    }
  });

  it('uses the canonical integration when a legacy Slack row also exists', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedWorkspace(tx, {
        name: 'LegacyFirst',
        slackTeamId: 'T-LEGACY',
        botToken: 'xoxb-legacy',
      });
      const canonicalIntegrationId = `int_${randomUUIDv7()}`;
      await tx.insert(integration).values({
        id: canonicalIntegrationId,
        organizationId: fixture.organizationId,
        provider: 'slack',
        externalId: 'default',
        connectedById: fixture.userId,
        credentials: { botToken: 'xoxb-canonical' },
        config: { scopes: ['chat:write', 'im:write'], slackTeamId: 'T-CANONICAL' },
      });
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: canonicalIntegrationId,
        userId: fixture.userId,
        slackUserId: 'U-CANONICAL',
        slackDisplayName: 'Canonical user',
      });
      const calls: { authorization: string; body: Record<string, unknown> }[] = [];
      const fetch = ((_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string>;
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        calls.push({ authorization: headers['authorization'] ?? '', body });
        const response = _url.endsWith('conversations.open')
          ? { ok: true, channel: { id: 'D-CANONICAL' } }
          : { ok: true, channel: 'D-CANONICAL', ts: '1.0' };
        return Promise.resolve(Response.json(response));
      }) as unknown as typeof globalThis.fetch;

      expect(await slackDmAvailable(tx, fixture.organizationId, fixture.userId)).toBe(true);
      expect(
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'Private notification',
          fetch,
        }),
      ).toBe(1);
      expect(calls).toEqual([
        {
          authorization: 'Bearer xoxb-canonical',
          body: { users: 'U-CANONICAL' },
        },
        {
          authorization: 'Bearer xoxb-canonical',
          body: { channel: 'D-CANONICAL', text: 'Private notification' },
        },
      ]);
    });
  });

  it('rejects a mapping whose organization does not own the integration', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const other = await seedWorkspace(tx, { name: 'OtherTenant' });
      await tx
        .update(integration)
        .set({ config: { scopes: ['chat:write', 'im:write'] } })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: other.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-CROSS-TENANT',
        slackDisplayName: 'Wrong tenant',
      });
      const fetch = (() => {
        throw new Error('Slack must not receive a cross-tenant DM.');
      }) as unknown as typeof globalThis.fetch;

      expect(await slackDmAvailable(tx, fixture.organizationId, fixture.userId)).toBe(false);
      expect(
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'Tenant secret',
          fetch,
        }),
      ).toBe(0);
    });
  });

  it('opens the mapped conversation and posts the message', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({ config: { scopes: ['chat:write', 'im:write'] } })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U123',
        slackDisplayName: 'Ada Slack',
      });
      const calls: { method: string; body: Record<string, unknown> }[] = [];
      const fetch = ((_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        calls.push({ method: _url.split('/').pop() ?? '', body });
        const response = _url.endsWith('conversations.open')
          ? { ok: true, channel: { id: 'D123' } }
          : { ok: true, channel: 'D123', ts: '1.0' };
        return Promise.resolve(new Response(JSON.stringify(response), { status: 200 }));
      }) as unknown as typeof globalThis.fetch;

      const delivered = await dispatchSlackDm(tx, {
        organizationId: fixture.organizationId,
        userId: fixture.userId,
        text: 'You were mentioned',
        fetch,
      });
      expect(delivered).toBe(1);
      expect(calls).toEqual([
        { method: 'conversations.open', body: { users: 'U123' } },
        {
          method: 'chat.postMessage',
          body: { channel: 'D123', text: 'You were mentioned' },
        },
      ]);

      expect(
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'A second mention',
          fetch,
        }),
      ).toBe(1);
      expect(calls.filter((call) => call.method === 'conversations.open')).toHaveLength(1);
      expect(calls.filter((call) => call.method === 'chat.postMessage')).toHaveLength(2);
    });
  });

  it('reopens and replaces a stale cached DM channel', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({ config: { scopes: ['chat:write', 'im:write'] } })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U123',
        slackDisplayName: 'Ada Slack',
      });
      await tx
        .update(slackUserMapping)
        .set({ slackChannelId: 'D-STALE' })
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      const calls: { method: string; body: Record<string, unknown> }[] = [];
      let postAttempts = 0;
      const fetch = ((url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const method = url.split('/').pop() ?? '';
        calls.push({ method, body });
        if (url.endsWith('conversations.open')) {
          return Promise.resolve(Response.json({ ok: true, channel: { id: 'D-FRESH' } }));
        }
        postAttempts += 1;
        return Promise.resolve(
          Response.json(
            postAttempts === 1
              ? { ok: false, error: 'channel_not_found' }
              : { ok: true, channel: 'D-FRESH', ts: '2.0' },
          ),
        );
      }) as unknown as typeof globalThis.fetch;

      expect(
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'A private update',
          fetch,
        }),
      ).toBe(1);
      expect(calls).toEqual([
        { method: 'chat.postMessage', body: { channel: 'D-STALE', text: 'A private update' } },
        { method: 'conversations.open', body: { users: 'U123' } },
        { method: 'chat.postMessage', body: { channel: 'D-FRESH', text: 'A private update' } },
      ]);
      const [mapping] = await tx
        .select({ slackChannelId: slackUserMapping.slackChannelId })
        .from(slackUserMapping)
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      expect(mapping?.slackChannelId).toBe('D-FRESH');
    });
  });

  it('clears a cached DM channel when the mapped Slack identity changes', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-OLD',
        slackDisplayName: 'Old identity',
      });
      await tx
        .update(slackUserMapping)
        .set({ slackChannelId: 'D-OLD' })
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));

      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U-NEW',
        slackDisplayName: 'New identity',
      });

      const [mapping] = await tx
        .select({
          slackChannelId: slackUserMapping.slackChannelId,
          slackUserId: slackUserMapping.slackUserId,
        })
        .from(slackUserMapping)
        .where(eq(slackUserMapping.integrationId, fixture.integrationId));
      expect(mapping).toEqual({ slackChannelId: null, slackUserId: 'U-NEW' });
    });
  });

  it('propagates permanent provider failures for worker classification', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({ config: { scopes: ['chat:write', 'im:write'] } })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U123',
        slackDisplayName: 'Ada Slack',
      });
      const fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), { status: 200 }),
        )) as unknown as typeof globalThis.fetch;
      let error: unknown;
      try {
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'Provider failure',
          fetch,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'invalid_auth' });
    });
  });

  it('propagates transient provider failures for worker retry handling', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      await tx
        .update(integration)
        .set({ config: { scopes: ['chat:write', 'im:write'] } })
        .where(eq(integration.id, fixture.integrationId));
      await upsertSlackUserMapping(tx, {
        organizationId: fixture.organizationId,
        integrationId: fixture.integrationId,
        userId: fixture.userId,
        slackUserId: 'U123',
        slackDisplayName: 'Ada Slack',
      });
      const fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), { status: 200 }),
        )) as unknown as typeof globalThis.fetch;
      let error: unknown;
      try {
        await dispatchSlackDm(tx, {
          organizationId: fixture.organizationId,
          userId: fixture.userId,
          text: 'Retry me',
          fetch,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'ratelimited' });
    });
  });

  it('rejects a successful response that carries no usable message identity', async () => {
    for (const malformed of [
      { ok: true, channel: 'D123' },
      { ok: true, channel: 'D123', ts: '' },
    ]) {
      await withRollback(async (tx) => {
        const fixture = await seed(tx);
        await tx
          .update(integration)
          .set({ config: { scopes: ['chat:write', 'im:write'] } })
          .where(eq(integration.id, fixture.integrationId));
        await upsertSlackUserMapping(tx, {
          organizationId: fixture.organizationId,
          integrationId: fixture.integrationId,
          userId: fixture.userId,
          slackUserId: 'U123',
          slackDisplayName: 'Ada Slack',
        });
        const fetch = ((url: string) =>
          Promise.resolve(
            new Response(
              JSON.stringify(
                url.endsWith('conversations.open')
                  ? { ok: true, channel: { id: 'D123' } }
                  : malformed,
              ),
              { status: 200 },
            ),
          )) as unknown as typeof globalThis.fetch;
        let error: unknown;
        let delivered: number | undefined;
        try {
          delivered = await dispatchSlackDm(tx, {
            organizationId: fixture.organizationId,
            userId: fixture.userId,
            text: 'Malformed success',
            fetch,
          });
        } catch (caught) {
          error = caught;
        }
        expect(delivered).toBeUndefined();
        expect(error).toBeDefined();
      });
    }
  });
});

describe('issueIdentifierFromUrl', () => {
  it('extracts a valid identifier and rejects noise', () => {
    expect(issueIdentifierFromUrl('https://orbit.local/issue/ENG-42/foo')).toBe('ENG-42');
    expect(issueIdentifierFromUrl('https://orbit.local/issue/eng-42')).toBe('ENG-42');
    expect(issueIdentifierFromUrl('https://orbit.local/projects/x')).toBeNull();
  });
});

describe('resolveIssueUnfurls', () => {
  it('builds unfurl blocks keyed by the shared url', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const suffix = fixture.organizationId.slice(4);
      const stateId = `st_${suffix}`;
      await tx.insert(workflowState).values({
        id: stateId,
        organizationId: fixture.organizationId,
        teamId: fixture.teamA,
        name: 'In Progress',
        category: 'started',
        color: '#888',
        position: 3,
      });
      await tx.insert(issue).values({
        id: `iss_${suffix}`,
        organizationId: fixture.organizationId,
        teamId: fixture.teamA,
        number: 42,
        identifier: 'ENG-42',
        title: 'Ship the thing',
        stateId,
        creatorId: `usr_${suffix}`,
      });

      const url = 'https://orbit.local/issue/ENG-42';
      const unfurls = await resolveIssueUnfurls(tx, fixture.organizationId, [url]);
      expect(Object.keys(unfurls)).toEqual([url]);
      expect(JSON.stringify(unfurls[url])).toContain('ENG-42');
      expect(JSON.stringify(unfurls[url])).toContain('In Progress');
    });
  });

  it('limits a team mapping to issues in that exact team', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const suffix = fixture.organizationId.slice(4);
      const stateId = `st_scope_${suffix}`;
      await tx.insert(workflowState).values({
        id: stateId,
        organizationId: fixture.organizationId,
        teamId: fixture.teamA,
        name: 'Scoped',
        category: 'started',
        color: '#888',
        position: 3,
      });
      await tx.insert(issue).values({
        id: `iss_scope_${suffix}`,
        organizationId: fixture.organizationId,
        teamId: fixture.teamA,
        number: 43,
        identifier: 'ENG-43',
        title: 'Team A only',
        stateId,
        creatorId: `usr_${suffix}`,
      });
      const url = 'https://orbit.local/issue/ENG-43';

      expect(await resolveIssueUnfurls(tx, fixture.organizationId, [url], fixture.teamB)).toEqual(
        {},
      );
      expect(
        Object.keys(await resolveIssueUnfurls(tx, fixture.organizationId, [url], fixture.teamA)),
      ).toEqual([url]);
    });
  });

  it('treats an omitted team scope as workspace-wide within the organization', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const other = await seed(tx);
      const suffix = fixture.organizationId.slice(4);
      const stateId = `st_workspace_${suffix}`;
      await tx.insert(workflowState).values({
        id: stateId,
        organizationId: fixture.organizationId,
        teamId: fixture.teamA,
        name: 'Workspace scoped',
        category: 'started',
        color: '#888',
        position: 3,
      });
      await tx.insert(issue).values({
        id: `iss_workspace_${suffix}`,
        organizationId: fixture.organizationId,
        teamId: fixture.teamA,
        number: 44,
        identifier: 'ENG-44',
        title: 'Workspace issue',
        stateId,
        creatorId: `usr_${suffix}`,
      });
      const url = 'https://orbit.local/issue/ENG-44';

      expect(Object.keys(await resolveIssueUnfurls(tx, fixture.organizationId, [url]))).toEqual([
        url,
      ]);
      expect(await resolveIssueUnfurls(tx, other.organizationId, [url])).toEqual({});
    });
  });
});
