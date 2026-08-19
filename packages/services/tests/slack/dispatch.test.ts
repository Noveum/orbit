import { describe, expect, it } from 'bun:test';
import {
  integration,
  issue,
  organization,
  slackChannelSync,
  team,
  user,
  workflowState,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { eq } from 'drizzle-orm';
import {
  connectSlackChannel,
  disconnectSlackChannel,
  dispatchSlackMessage,
  ensureSlackIntegration,
  issueIdentifierFromUrl,
  resolveIssueUnfurls,
  resolveSlackContext,
  resolveSlackTargets,
} from '../../src/slack/dispatch.ts';
import { type TestTransaction, withRollback } from '../../src/test-database.ts';

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
  return await seedWorkspace(tx, { name: 'Acme', botToken: 'xoxb-test' });
}

describe('resolveSlackContext', () => {
  it('reads the bot token from integration credentials', async () => {
    await withRollback(async (tx) => {
      const fixture = await seed(tx);
      const context = await resolveSlackContext(tx, fixture.organizationId);
      expect(context?.token).toBe('xoxb-test');
    });
  });
});

describe('ensureSlackIntegration', () => {
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
      expect(integrationId).toBe(legacy!.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        externalId: 'default',
        config: { slackTeamId: 'T0123', scopes: ['im:write'] },
        credentials: { botToken: 'xoxb-new' },
      });
    });
  });
});

describe('resolveSlackContext stays inside the workspace it was asked about', () => {
  it('hands each workspace its own integration row and its own bot token', async () => {
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

      expect(await resolveSlackContext(tx, acme.organizationId)).toEqual({
        integrationId: acme.integrationId,
        token: 'xoxb-acme',
      });
      expect(await resolveSlackContext(tx, globex.organizationId)).toEqual({
        integrationId: globex.integrationId,
        token: 'xoxb-globex',
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
        token: 'xoxb-acme',
      });
    });
  });
});

describe('resolveSlackTargets keeps a channel inside the workspace it belongs to', () => {
  it('never offers another workspace channel to an issue on this one', async () => {
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
});
