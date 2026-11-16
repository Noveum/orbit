import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { REDIS_DELTA_CHANNEL, REDIS_PRESENCE_CHANNEL, type SyncAction } from '@orbit/shared/events';
import { z } from 'zod';
import type { ConnectionPrincipal } from '../../src/auth.ts';
import { FakeRedis } from '../fake-redis.ts';
import { FakeSocket, settle, waitFor } from '../fake-socket.ts';

const mode = z
  .enum(['idle', 'foreign', 'reconnect', 'active-boundary', 'presence'])
  .parse(process.argv[2]);
const home = 'local-home';
const away = 'local-away';
const issue = 'local-issue';
const oldTeam = 'local-old-team';
const newTeam = 'local-new-team';
let lookupCount = 0;
let reachCount = 0;
let currentTeam = oldTeam;
let currentSyncId = 10;
let nextPrincipal: ConnectionPrincipal = principal(home, [oldTeam]);
const errors: string[] = [];

function principal(organizationId: string, teamIds: readonly string[]): ConnectionPrincipal {
  return {
    userId: `local-user-${teamIds.join('-')}`,
    sessionId: 'local-session',
    name: 'Local fixture',
    image: null,
    organizationId,
    role: 'member',
    teamIds,
  };
}

mock.module('@orbit/db', () => {
  throw new Error('The unobserved delta fixture must never import a real database.');
});
mock.module('ioredis', () => ({ Redis: FakeRedis }));
mock.module('../../src/logger.ts', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => errors.push(message),
  },
  errorFields: () => ({}),
}));
mock.module('../../src/auth.ts', () => ({
  authenticateTicket: async () => ({ ok: true, principal: nextPrincipal }),
  authorizedIssueTeamId: async () => currentTeam,
  authorizeScope: async () => true,
  issueReachInOrganization: () => {
    reachCount += 1;
    return Promise.resolve({ teamId: currentTeam, syncId: currentSyncId });
  },
  issueTeamIdInOrganization: () => {
    lookupCount += 1;
    return Promise.resolve(currentTeam);
  },
  liveSessionIds: async () => new Set(['local-session']),
  memberDeleteSchema: z.object({ userId: z.string() }),
  membershipStillValid: async () => true,
  readTicketFrame: () => ({}),
  refreshedPrincipal: async () => nextPrincipal,
  sessionStillValid: async () => true,
}));

const { createRealtimeHub } = await import('../../src/hub.ts');
const hub = await createRealtimeHub({
  redisUrl: 'redis://fake:6379',
  ticketSecret: 'local-unobserved-delta-fixture',
  batchWindowMs: 0,
});
const driver = new FakeRedis('redis://fake:6379');

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: currentSyncId,
    organizationId: home,
    scopes: [`issue:${issue}`, `team:${currentTeam}`],
    action: 'update',
    model: 'issue',
    modelId: issue,
    data: { id: issue, teamId: currentTeam },
    actor: { type: 'user', id: 'local-actor' },
    at: '2026-11-17T00:00:00.000Z',
    ...overrides,
  };
}

async function publish(value: SyncAction): Promise<void> {
  await driver.publish(REDIS_DELTA_CHANNEL, JSON.stringify([value]));
  await settle(12);
}

async function connect(organizationId: string, teamIds: readonly string[]) {
  nextPrincipal = principal(organizationId, teamIds);
  const socket = new FakeSocket();
  const session = hub.accept(socket);
  session.message('{}');
  await waitFor(() => socket.frames('ready').length === 1, 'local authentication');
  session.message(
    JSON.stringify({
      type: 'subscribe',
      scopes: [`issue:${issue}`, ...teamIds.map((id) => `team:${id}`)],
    }),
  );
  await waitFor(() => socket.frames('subscribed').length === 1, 'local subscriptions');
  return { socket, session };
}

function delivered(socket: FakeSocket): number[] {
  return socket.frames('delta').flatMap((frame) => frame.actions.map((value) => value.syncId));
}

try {
  if (mode === 'idle' || mode === 'foreign') {
    const observer = mode === 'foreign' ? await connect(home, [oldTeam]) : null;
    const organizationId = mode === 'foreign' ? away : home;
    await publish(action({ organizationId }));
    await publish(
      action({ organizationId, data: { id: issue, teamId: oldTeam, teamChanged: true } }),
    );
    await publish(
      action({ organizationId, action: 'delete', data: { id: issue, teamId: oldTeam } }),
    );
    assert.equal(lookupCount, 0, 'An unobserved organization must not query issue audiences');
    assert.equal(reachCount, 0, 'An unobserved organization must not validate moves or deletions');
    if (observer !== null) {
      await publish(action());
      await waitFor(
        () => delivered(observer.socket).includes(10),
        'an observed organization delta',
      );
      assert.equal(lookupCount, 1);
    }
  }

  if (mode === 'reconnect') {
    const original = await connect(home, [oldTeam]);
    await publish(action());
    await waitFor(() => delivered(original.socket).includes(10), 'warm cached audience');
    original.session.closed();
    currentTeam = newTeam;
    currentSyncId = 20;
    await publish(action({ data: { id: issue, teamId: newTeam, teamChanged: true } }));
    const source = await connect(home, [oldTeam]);
    const destination = await connect(home, [newTeam]);
    await publish(
      action({
        syncId: 11,
        scopes: [`issue:${issue}`, `team:${oldTeam}`],
        data: { id: issue, teamId: oldTeam },
      }),
    );
    assert.deepEqual(
      delivered(source.socket),
      [],
      'Reconnect must not reuse the previous audience',
    );
    await publish(action({ syncId: 21 }));
    await waitFor(() => delivered(destination.socket).includes(21), 'fresh destination audience');
    assert.equal(lookupCount, 2, 'Reconnect must query the current team after skipped traffic');
    assert.equal(reachCount, 0, 'The unobserved move must not query Postgres');
  }

  if (mode === 'active-boundary') {
    currentTeam = newTeam;
    currentSyncId = 20;
    const observer = await connect(home, [newTeam]);
    await publish(action({ data: { id: issue, teamId: newTeam, teamChanged: true } }));
    await waitFor(() => delivered(observer.socket).includes(20), 'the observed move');
    await publish(action({ organizationId: away }));
    await publish(action({ syncId: 10 }));
    await publish(action({ syncId: 21 }));
    await waitFor(() => delivered(observer.socket).includes(21), 'the later observed delta');
    assert.deepEqual(
      delivered(observer.socket),
      [20, 21],
      'Foreign traffic must preserve the active move boundary',
    );
    assert.equal(lookupCount, 0, 'Foreign traffic must not evict another organization boundary');
    assert.equal(reachCount, 1);
  }

  if (mode === 'presence') {
    const observer = await connect(home, [oldTeam]);
    const presence = (organizationId: string, scope: string, userId: string) => ({
      organizationId,
      scope,
      userId,
      name: 'Local presence',
      image: null,
      kind: 'viewing',
      at: new Date().toISOString(),
      audience: { teamId: oldTeam },
    });
    await driver.publish(
      REDIS_PRESENCE_CHANNEL,
      JSON.stringify(presence(home, `issue:${issue}`, 'local-peer')),
    );
    await driver.publish(
      REDIS_PRESENCE_CHANNEL,
      JSON.stringify(presence(away, 'issue:foreign-issue', 'foreign-peer')),
    );
    await settle(12);
    await publish(
      action({
        organizationId: away,
        modelId: 'foreign-issue',
        action: 'delete',
        scopes: ['issue:foreign-issue', `team:${oldTeam}`],
        data: { id: 'foreign-issue', teamId: oldTeam },
      }),
    );
    assert.equal(reachCount, 0, 'Foreign deletion must not query Postgres');
    const another = await connect(home, [oldTeam]);
    assert.ok(
      another.socket
        .frames('presence')
        .some((frame) => frame.messages.some((message) => message.userId === 'local-peer')),
    );
    observer.session.closed();
    another.session.closed();
    await publish(action({ action: 'delete', data: { id: issue, teamId: oldTeam } }));
    const reconnected = await connect(home, [oldTeam]);
    assert.deepEqual(
      reconnected.socket.frames('presence'),
      [],
      'Skipped deletion must remove old issue presence',
    );
    assert.equal(reachCount, 0);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ completed: true, mode, lookupCount, reachCount }));
} finally {
  await hub.close();
  driver.disconnect();
}
