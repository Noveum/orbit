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
import { randomUUIDv7 } from 'bun';
import { eq } from 'drizzle-orm';
import { type TestTransaction, withRollback } from '../test-database.ts';
import {
  connectSlackChannel,
  disconnectSlackChannel,
  issueIdentifierFromUrl,
  resolveIssueUnfurls,
  resolveSlackContext,
  resolveSlackTargets,
} from './dispatch.ts';

interface Fixture {
  readonly organizationId: string;
  readonly integrationId: string;
  readonly teamA: string;
  readonly teamB: string;
}

async function seed(tx: TestTransaction): Promise<Fixture> {
  const suffix = randomUUIDv7();
  const organizationId = `org_${suffix}`;
  await tx
    .insert(organization)
    .values({ id: organizationId, name: 'Acme', slug: `acme-${suffix.toLowerCase()}` });
  await tx.insert(user).values({
    id: `usr_${suffix}`,
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

  const integrationId = `int_${suffix}`;
  await tx.insert(integration).values({
    id: integrationId,
    organizationId,
    provider: 'slack',
    externalId: 'T123',
    connectedById: `usr_${suffix}`,
    credentials: { botToken: 'xoxb-test' },
  });

  return { organizationId, integrationId, teamA, teamB };
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
