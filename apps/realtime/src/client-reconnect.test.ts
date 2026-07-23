import { afterAll, beforeAll, expect, it } from 'bun:test';
import { createRealtimeClient, type RealtimeStatus } from '@orbit/realtime-client';
import { type SyncAction, scopes } from '@orbit/shared/events';
import { createRealtimeServer, type RealtimeServer } from './server.ts';
import {
  cleanupFixtures,
  createMember,
  createOrganization,
  createPublisher,
  createTeam,
  delay,
  redisUrl,
  type SeedMember,
  syncAction,
} from './test-helpers.ts';

const DELTA_CHANNEL = 'orbit:delta';

let organizationId = '';
let teamId = '';
let member: SeedMember;

beforeAll(async () => {
  organizationId = await createOrganization();
  teamId = await createTeam(organizationId);
  member = await createMember({ organizationId, teamIds: [teamId] });
});

afterAll(async () => {
  await cleanupFixtures();
});

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await delay(25);
  }
}

it('reconnects and resubscribes after the server drops the socket', async () => {
  const first = await createRealtimeServer({ redisUrl: redisUrl(), batchWindowMs: 20 });
  const port = first.port;
  const statuses: RealtimeStatus[] = [];
  const received: SyncAction[] = [];

  const client = createRealtimeClient({
    url: `ws://127.0.0.1:${port}`,
    token: member.token,
    organizationId,
    maxBackoffMs: 500,
    onStatus: (status) => statuses.push(status),
    onDelta: (actions) => received.push(...actions),
  });

  let second: RealtimeServer | undefined;
  const publisher = createPublisher();
  try {
    await waitUntil(() => client.status() === 'open');
    client.subscribe([scopes.team(teamId)]);
    await waitUntil(() => first.stats().subscriptions === 1);

    await first.close();
    await waitUntil(() => client.status() === 'reconnecting');

    second = await createRealtimeServer({ redisUrl: redisUrl(), port, batchWindowMs: 20 });
    await waitUntil(() => client.status() === 'open');
    await waitUntil(() => (second?.stats().subscriptions ?? 0) === 1);

    await publisher.publish(
      DELTA_CHANNEL,
      JSON.stringify(
        syncAction({
          organizationId,
          scopes: [scopes.team(teamId)],
          modelId: 'issue_after_reconnect',
          syncId: 900,
        }),
      ),
    );
    await waitUntil(() => received.some((action) => action.modelId === 'issue_after_reconnect'));

    expect(statuses).toContain('reconnecting');
    expect(statuses.at(-1)).toBe('open');
  } finally {
    client.close();
    publisher.close();
    await second?.close();
  }
});
