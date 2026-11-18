import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
  type SyncAction,
} from '@orbit/shared/events';
import * as auth from '../src/auth.ts';
import { createLoopbackBus } from '../src/bus.ts';
import type { ConnectionSnapshot } from '../src/connection.ts';
import { createRealtimeHub, type RealtimeHub } from '../src/hub.ts';
import { FakeSocket, settle, waitFor } from './fake-socket.ts';

const ORGANIZATION = 'org_loopback';

function snapshot(id: string, scopes: readonly string[]): ConnectionSnapshot {
  return {
    id,
    principal: {
      userId: `user_${id}`,
      sessionId: `session_${id}`,
      name: 'Restored Reader',
      image: null,
      organizationId: ORGANIZATION,
      role: 'member',
      teamIds: [],
    },
    scopes,
    watermark: 10,
  };
}

function labelUpdate(syncId: number, modelId = 'label_1'): SyncAction {
  return {
    syncId,
    organizationId: ORGANIZATION,
    scopes: [`org:${ORGANIZATION}`],
    action: 'update',
    model: 'label',
    modelId,
    data: { name: 'Renamed' },
    actor: { type: 'user', id: 'user_writer' },
    at: new Date().toISOString(),
  };
}

let hub: RealtimeHub | undefined;

async function duringMembershipRefresh(
  bus: ReturnType<typeof createLoopbackBus>,
  whileBlocked: () => void | Promise<void>,
): Promise<void> {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const lookup = spyOn(auth, 'refreshedPrincipal').mockImplementation(async (principal) => {
    entered.resolve();
    await release.promise;
    return principal;
  });
  const delta = bus.publish(
    REDIS_DELTA_CHANNEL,
    JSON.stringify([{ ...labelUpdate(11), model: 'member', modelId: 'member_reader' }]),
  );
  try {
    await entered.promise;
    await whileBlocked();
  } finally {
    release.resolve();
    await delta;
    lookup.mockRestore();
  }
}

afterEach(async () => {
  await hub?.close();
  hub = undefined;
});

describe('a hub on the loopback bus', () => {
  it('delivers a published delta to a connection restored from its snapshot', async () => {
    const bus = createLoopbackBus();
    hub = await createRealtimeHub({ bus, scheduling: 'manual', ticketSecret: 'x'.repeat(32) });
    const socket = new FakeSocket();
    hub.restore(socket, snapshot('restored', [`org:${ORGANIZATION}`]));

    await bus.publish(REDIS_DELTA_CHANNEL, JSON.stringify([labelUpdate(11)]));
    await waitFor(() => socket.last('delta') !== undefined, 'the restored connection got a delta');

    expect(socket.last('delta')?.actions.map((action) => action.modelId)).toEqual(['label_1']);
    expect(hub.stats()).toEqual({ connections: 1, subscriptions: 1, redis: 'ready' });
  });

  it('keeps the watermark a restored connection had reached', async () => {
    const bus = createLoopbackBus();
    hub = await createRealtimeHub({
      bus,
      scheduling: 'manual',
      ticketSecret: 'x'.repeat(32),
      batchWindowMs: 1,
    });
    const socket = new FakeSocket();
    hub.restore(socket, snapshot('restored', [`org:${ORGANIZATION}`]));

    await bus.publish(REDIS_DELTA_CHANNEL, JSON.stringify([labelUpdate(10, 'stale_label')]));
    await bus.publish(REDIS_DELTA_CHANNEL, JSON.stringify([labelUpdate(12)]));
    await waitFor(() => socket.last('delta') !== undefined, 'the newer delta arrived');

    expect(socket.frames('delta').flatMap((frame) => frame.actions.map((a) => a.syncId))).toEqual([
      12,
    ]);
  });

  it('reports every durable change so a host can persist the connection', async () => {
    const changes: ConnectionSnapshot[] = [];
    hub = await createRealtimeHub({
      bus: createLoopbackBus(),
      scheduling: 'manual',
      ticketSecret: 'x'.repeat(32),
      onConnectionChange: (change) => changes.push(change),
    });
    const socket = new FakeSocket();
    const session = hub.restore(socket, snapshot('restored', ['org:a', 'team:b']));

    session.message(JSON.stringify({ type: 'unsubscribe', scopes: ['team:b'] }));
    await waitFor(() => changes.length === 2, 'the unsubscribe was reported');

    expect(changes.map((change) => change.scopes)).toEqual([['org:a', 'team:b'], ['org:a']]);
    expect(changes.every((change) => change.id === 'restored')).toBe(true);
  });

  it('closes restored connections when their organization is deleted', async () => {
    const bus = createLoopbackBus();
    hub = await createRealtimeHub({ bus, scheduling: 'manual', ticketSecret: 'x'.repeat(32) });
    const socket = new FakeSocket();
    hub.restore(socket, snapshot('restored', [`org:${ORGANIZATION}`]));

    await bus.publish(
      REDIS_CONTROL_CHANNEL,
      JSON.stringify({ type: 'organization_deleted', organizationId: ORGANIZATION }),
    );

    expect(socket.closures.map((closure) => closure.reason)).toEqual(['organization_deleted']);
    expect(hub.stats().connections).toBe(0);
  });

  it('runs heartbeats and sweeps only when the host asks', async () => {
    const bus = createLoopbackBus();
    hub = await createRealtimeHub({
      bus,
      scheduling: 'manual',
      ticketSecret: 'x'.repeat(32),
      heartbeatIntervalMs: 1,
      heartbeatTimeoutMs: Number.POSITIVE_INFINITY,
      presenceTtlMs: 60_000,
    });
    const socket = new FakeSocket();
    hub.restore(socket, snapshot('restored', [`org:${ORGANIZATION}`]));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(socket.pings).toBe(0);
    hub.heartbeat();
    expect(socket.pings).toBe(1);
    expect(socket.terminated).toBe(0);

    expect(hub.sweep()).toBe(false);
    await bus.publish(
      REDIS_PRESENCE_CHANNEL,
      JSON.stringify({
        organizationId: ORGANIZATION,
        scope: `org:${ORGANIZATION}`,
        kind: 'viewing',
        userId: 'user_other',
        name: 'Other Reader',
        image: null,
        at: new Date().toISOString(),
      }),
    );
    await waitFor(() => socket.last('presence') !== undefined, 'presence reached the reader');
    expect(hub.sweep()).toBe(true);
  });

  it('uses the id the socket carries for a restored connection', async () => {
    const changes: string[] = [];
    hub = await createRealtimeHub({
      bus: createLoopbackBus(),
      scheduling: 'manual',
      ticketSecret: 'x'.repeat(32),
      onConnectionChange: (change) => changes.push(change.id),
    });
    hub.restore(new FakeSocket(), snapshot('socket-7', []));
    expect(changes).toEqual(['socket-7']);
  });

  it('waits for prior deltas before completing a presence publication', async () => {
    const bus = createLoopbackBus();
    hub = await createRealtimeHub({ bus, scheduling: 'manual', ticketSecret: 'x'.repeat(32) });
    const scope = `org:${ORGANIZATION}`;
    const socket = new FakeSocket();
    hub.restore(socket, snapshot('reader', [scope]));
    let completed = false;
    let presence: Promise<void> | undefined;
    await duringMembershipRefresh(bus, async () => {
      presence = bus
        .publish(
          REDIS_PRESENCE_CHANNEL,
          JSON.stringify({
            organizationId: ORGANIZATION,
            scope,
            kind: 'viewing',
            userId: 'other',
            name: 'Other Reader',
            image: null,
            at: new Date().toISOString(),
          }),
        )
        .then(() => {
          completed = true;
        });
      await settle(1);
      expect(completed).toBe(false);
      expect(socket.frames('presence')).toHaveLength(0);
    });
    await presence;
    expect(completed).toBe(true);
    expect(socket.frames('presence')).toHaveLength(1);
  });

  it('stops reporting snapshots when a reader disconnects during a membership refresh', async () => {
    const bus = createLoopbackBus();
    const changes: ConnectionSnapshot[] = [];
    hub = await createRealtimeHub({
      bus,
      scheduling: 'manual',
      ticketSecret: 'x'.repeat(32),
      onConnectionChange: (value) => changes.push(value),
    });
    const session = hub.restore(new FakeSocket(), snapshot('reader', []));
    await duringMembershipRefresh(bus, () => {
      session.closed();
    });
    expect(changes).toHaveLength(1);
  });

  it('retains presence by the time the originating socket event completes', async () => {
    hub = await createRealtimeHub({
      bus: createLoopbackBus(),
      scheduling: 'manual',
      ticketSecret: 'x'.repeat(32),
    });
    const scope = `org:${ORGANIZATION}`;
    const session = hub.restore(new FakeSocket(), snapshot('sender', [scope]));
    await session.message(JSON.stringify({ type: 'presence', scope, kind: 'viewing' }));
    expect(hub.sweep()).toBe(true);
  });
});
