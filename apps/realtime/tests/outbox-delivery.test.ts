import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  closeRealtime,
  drainIssueOutbox,
  newId,
  publishDeltas,
  stageIssueActions,
} from '@orbit/core';
import { db, eq, isNull, schema } from '@orbit/db';
import { createRealtimeClient } from '@orbit/realtime-client';
import { type SyncAction, scopes } from '@orbit/shared/events';
import { createRealtimeServer, type RealtimeServer } from '../src/server.ts';
import {
  cleanupFixtures,
  createIssue,
  createMember,
  createOrganization,
  createTeam,
  delay,
  redisUrl,
  type SeedMember,
  ticketFor,
} from '../src/test-helpers.ts';

const BATCH_WINDOW_MS = 20;

let server: RealtimeServer;
let organizationId = '';
let teamId = '';
let otherTeamId = '';
let member: SeedMember;
let outsider: SeedMember;

beforeAll(async () => {
  organizationId = await createOrganization();
  teamId = await createTeam(organizationId);
  otherTeamId = await createTeam(organizationId);
  member = await createMember({ organizationId, teamIds: [teamId] });
  outsider = await createMember({ organizationId, teamIds: [otherTeamId] });
  server = await createRealtimeServer({ redisUrl: redisUrl(), batchWindowMs: BATCH_WINDOW_MS });
  await db.delete(schema.issueOutbox);
});

afterAll(async () => {
  await server.close();
  await closeRealtime();
  await cleanupFixtures();
});

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await delay(20);
  }
}

function collector(): { actions: SyncAction[] } {
  return { actions: [] };
}

function clientFor(
  seed: SeedMember,
  sink: { actions: SyncAction[] },
  onDenied?: (scopes: string[]) => void,
) {
  return createRealtimeClient({
    url: `ws://127.0.0.1:${server.port}/api/ws`,
    fetchTicket: () => Promise.resolve(ticketFor(seed, organizationId)),
    onDelta: (actions) => sink.actions.push(...actions),
    ...(onDenied === undefined ? {} : { onDenied }),
  });
}

async function stageIssueAction(issueId: string, syncId: number, grantId: string): Promise<string> {
  const staged = await db.transaction(async (tx) =>
    stageIssueActions(
      tx,
      issueId,
      [
        {
          syncId,
          organizationId,
          scopes: [scopes.team(teamId), scopes.issue(issueId)],
          action: 'update',
          model: 'issue',
          modelId: issueId,
          data: {
            id: issueId,
            teamId,
            title: 'Agent touched this',
            grantId,
            nested: [{ grant_id: grantId }],
          },
          actor: { type: 'agent', id: 'agent_actor_1', name: 'Researcher' },
          at: new Date().toISOString(),
        },
      ],
      {
        grantId,
        attribution: {
          actor: {
            type: 'agent',
            id: 'agent_actor_1',
            name: 'Researcher',
            avatar: null,
            deleted: false,
          },
          principal: {
            type: 'user',
            id: member.userId,
            name: member.name,
            avatar: null,
            deleted: false,
          },
        },
      },
    ),
  );
  const eventId = staged[0]?.eventId;
  if (eventId === undefined) throw new Error('staging produced no event id');
  return eventId;
}

async function outboxRow(eventId: string) {
  const [row] = await db
    .select()
    .from(schema.issueOutbox)
    .where(eq(schema.issueOutbox.id, eventId));
  return row;
}

describe('issue outbox delivery', () => {
  it('P0-RT-1 delivers a staged issue action only to a reader inside the issue team and strips every grant id', async () => {
    const issueId = await createIssue(organizationId, teamId, member.userId);
    const eventId = await stageIssueAction(issueId, 10, 'grant_secret_delivery');
    const inside = collector();
    const outside = collector();
    const client = clientFor(member, inside);
    const other = clientFor(outsider, outside);
    try {
      await waitUntil(() => client.status() === 'open' && other.status() === 'open');
      client.subscribe([scopes.team(teamId)]);
      other.subscribe([scopes.team(otherTeamId)]);
      await waitUntil(() => server.stats().subscriptions === 2);

      expect(await drainIssueOutbox({ publish: publishDeltas })).toBe(1);
      await waitUntil(() => inside.actions.length > 0);

      expect(inside.actions.map((action) => action.eventId)).toEqual([eventId]);
      const wire = JSON.stringify(inside.actions);
      expect(wire).not.toContain('grantId');
      expect(wire).not.toContain('grant_id');
      expect(inside.actions[0]?.attribution?.actor).toMatchObject({
        type: 'agent',
        id: 'agent_actor_1',
        name: 'Researcher',
        deleted: false,
      });
      expect(inside.actions[0]?.attribution?.principal).toMatchObject({ type: 'user' });

      await delay(3 * BATCH_WINDOW_MS);
      expect(outside.actions).toHaveLength(0);
      expect((await outboxRow(eventId))?.deliveredAt).not.toBeNull();
    } finally {
      client.close();
      other.close();
    }
  });

  it('P0-RT-1 authorizes Project scoped Outbox events against current Project team access', async () => {
    const issueId = await createIssue(organizationId, teamId, member.userId);
    const projectId = newId();
    await db.insert(schema.project).values({
      id: projectId,
      organizationId,
      name: 'Realtime project',
      slug: projectId,
    });
    await db.insert(schema.projectTeam).values({
      id: newId(),
      projectId,
      teamId,
    });
    const staged = await db.transaction(async (tx) =>
      stageIssueActions(tx, issueId, [
        {
          syncId: 15,
          organizationId,
          scopes: [scopes.team(teamId), scopes.project(projectId)],
          action: 'update',
          model: 'issue',
          modelId: issueId,
          data: { id: issueId, teamId, projectId, title: 'Project event' },
          actor: { type: 'user', id: member.userId, name: member.name },
          at: new Date().toISOString(),
        },
      ]),
    );
    const eventId = staged[0]?.eventId;
    if (eventId === undefined) throw new Error('staging produced no event id');
    const inside = collector();
    const outside = collector();
    const deniedScopes: string[] = [];
    const reader = clientFor(member, inside);
    const outsiderClient = clientFor(outsider, outside, (denied) => deniedScopes.push(...denied));
    try {
      await waitUntil(() => reader.status() === 'open' && outsiderClient.status() === 'open');
      const projectScope = scopes.project(projectId);
      reader.subscribe([projectScope]);
      outsiderClient.subscribe([projectScope]);
      await waitUntil(() => deniedScopes.includes(projectScope));

      expect(await drainIssueOutbox({ publish: publishDeltas })).toBe(1);
      await waitUntil(() => inside.actions.length > 0);
      await delay(3 * BATCH_WINDOW_MS);

      expect(inside.actions.map((entry) => entry.eventId)).toEqual([eventId]);
      expect(outside.actions).toHaveLength(0);
      expect((await outboxRow(eventId))?.deliveredAt).not.toBeNull();
    } finally {
      reader.close();
      outsiderClient.close();
    }
  });

  it('P0-RT-1 lets a second worker reclaim an expired lease while the consumer applies the redelivered event once', async () => {
    const issueId = await createIssue(organizationId, teamId, member.userId);
    const eventId = await stageIssueAction(issueId, 20, 'grant_secret_lease');
    const sink = collector();
    const client = clientFor(member, sink);
    try {
      await waitUntil(() => client.status() === 'open');
      client.subscribe([scopes.team(teamId)]);
      await waitUntil(() => server.stats().subscriptions === 1);

      let releaseFirst: () => void = () => undefined;
      const hold = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const startedAt = new Date();
      const firstDeliveries: string[] = [];
      const first = drainIssueOutbox({
        now: startedAt,
        leaseMs: 40,
        publish: async (actions) => {
          firstDeliveries.push(...actions.map((action) => action.eventId ?? 'missing'));
          await publishDeltas(actions);
          await hold;
        },
      });

      await waitUntil(async () => (await outboxRow(eventId))?.leaseOwner !== null);
      await waitUntil(() => sink.actions.length > 0);

      const reclaimed = await drainIssueOutbox({
        now: new Date(startedAt.getTime() + 60_000),
        publish: publishDeltas,
      });
      expect(reclaimed).toBe(1);
      await delay(3 * BATCH_WINDOW_MS);

      releaseFirst();
      await first;

      expect(firstDeliveries).toEqual([eventId]);
      expect(sink.actions.map((action) => action.eventId)).toEqual([eventId]);
      const row = await outboxRow(eventId);
      expect(row?.deliveredAt).not.toBeNull();
      expect(row?.leaseOwner).toBeNull();
      expect(row?.attempts).toBe(0);
    } finally {
      client.close();
    }
  });

  it('P0-RT-1 leaves a failed publication undelivered and replays it under the same event id', async () => {
    const issueId = await createIssue(organizationId, teamId, member.userId);
    const eventId = await stageIssueAction(issueId, 30, 'grant_secret_retry');
    const pending = await db
      .select({ id: schema.issueOutbox.id })
      .from(schema.issueOutbox)
      .where(isNull(schema.issueOutbox.deliveredAt));
    expect(pending.map((row) => row.id)).toEqual([eventId]);

    expect(await drainIssueOutbox({ publish: () => Promise.reject(new Error('redis down')) })).toBe(
      1,
    );
    const failed = await outboxRow(eventId);
    expect(failed?.deliveredAt).toBeNull();
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toContain('redis down');

    const delivered: SyncAction[] = [];
    expect(
      await drainIssueOutbox({
        now: new Date(Date.now() + 60_000),
        publish: (actions) => {
          delivered.push(...actions);
          return Promise.resolve();
        },
      }),
    ).toBe(1);
    expect(delivered.map((action) => action.eventId)).toEqual([eventId]);
    expect(JSON.stringify(delivered)).not.toContain('grantId');
    expect((await outboxRow(eventId))?.deliveredAt).not.toBeNull();
  });
});
