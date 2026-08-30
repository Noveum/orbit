import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { ConnectionPrincipal } from '../src/auth.ts';
import { Connection, type ConnectionLimits } from '../src/connection.ts';
import type { RealtimeSocket } from '../src/socket.ts';

const principal: ConnectionPrincipal = {
  userId: 'user_1',
  sessionId: 'session_1',
  name: 'Ada',
  image: null,
  organizationId: 'org_1',
  role: 'member',
  teamIds: ['team_1'],
};

class FakeSocket {
  readyState = 1;
  buffered = 0;
  sent: string[] = [];
  terminated = false;
  pings = 0;
  closedWith: { code: number; reason: string } | undefined;

  send(payload: string): void {
    this.sent.push(payload);
  }

  bufferedAmount(): number {
    return this.buffered;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }

  ping(): void {
    this.pings += 1;
  }
}

function action(modelId: string, syncId: number, title: string): SyncAction {
  return {
    syncId,
    organizationId: 'org_1',
    scopes: ['team:team_1'],
    action: 'update',
    model: 'issue',
    modelId,
    data: { title },
    actor: { type: 'user', id: 'user_2' },
    at: new Date().toISOString(),
  };
}

function build(overrides: Partial<ConnectionLimits> = {}) {
  const socket = new FakeSocket();
  const limits: ConnectionLimits = {
    batchWindowMs: 5,
    maxSubscriptions: 3,
    maxBufferedBytes: 1_000,
    messageBurst: 5,
    messagesPerSecond: 10,
    ...overrides,
  };
  const connection = new Connection('conn_1', socket as RealtimeSocket, principal, limits);
  return { socket, connection };
}

describe('Connection', () => {
  it('coalesces queued actions into one ordered, de-duplicated delta', () => {
    const { socket, connection } = build();
    connection.queueDelta(action('issue_a', 3, 'first'));
    connection.queueDelta(action('issue_b', 1, 'other'));
    connection.queueDelta(action('issue_a', 5, 'newest'));
    connection.queueDelta(action('issue_c', 4, 'third'));
    connection.flushDeltas();

    expect(socket.sent).toHaveLength(1);
    const message = JSON.parse(socket.sent[0] ?? '{}');
    expect(message.type).toBe('delta');
    expect(message.actions.map((entry: SyncAction) => entry.modelId)).toEqual([
      'issue_b',
      'issue_c',
      'issue_a',
    ]);
    expect(message.actions.at(-1).data.title).toBe('newest');
  });

  it('keeps the final move departure before the coalesced arrival', () => {
    const { socket, connection } = build();
    connection.queueDelta({
      ...action('issue_a', 30, 'first arrival'),
      data: { teamChanged: true, title: 'first arrival' },
    });
    connection.queueDelta({
      ...action('issue_a', 31, 'departure'),
      action: 'delete',
      data: { departure: true },
    });
    connection.queueDelta({
      ...action('issue_a', 31, 'final arrival'),
      data: { teamChanged: true, title: 'final arrival' },
    });
    connection.flushDeltas();

    const message = JSON.parse(socket.sent[0] ?? '{}');
    expect(message.actions).toHaveLength(2);
    expect(message.actions.map((entry: SyncAction) => entry.action)).toEqual(['delete', 'update']);
    expect(message.actions[1]?.data).toEqual({ teamChanged: true, title: 'final arrival' });
  });

  it('keeps every departure identifier across consecutive moves', () => {
    const { socket, connection } = build();
    connection.queueDelta({
      ...action('issue_a', 30, 'departure from A'),
      action: 'delete',
      data: { departure: true, identifier: 'A-1' },
    });
    connection.queueDelta({
      ...action('issue_a', 30, 'arrival in B'),
      data: { teamChanged: true, identifier: 'B-1' },
    });
    connection.queueDelta({
      ...action('issue_a', 31, 'departure from B'),
      action: 'delete',
      data: { departure: true, identifier: 'B-1' },
    });
    connection.queueDelta({
      ...action('issue_a', 31, 'arrival in C'),
      data: { teamChanged: true, identifier: 'C-1' },
    });
    connection.flushDeltas();

    const message = JSON.parse(socket.sent[0] ?? '{}');
    expect(message.actions).toHaveLength(3);
    expect(message.actions.map((entry: SyncAction) => entry.data['identifier'])).toEqual([
      'A-1',
      'B-1',
      'C-1',
    ]);
    expect(message.actions.map((entry: SyncAction) => entry.action)).toEqual([
      'delete',
      'delete',
      'update',
    ]);
  });

  it('does not flush pending deltas while delivery is suspended', () => {
    const { socket, connection } = build();
    connection.queueDelta(action('issue_a', 40, 'restricted'));
    connection.suspendDeltaFlush();

    connection.flushDeltas();

    expect(socket.sent).toHaveLength(0);
    connection.resumeDeltaFlush(() => true);
    connection.flushDeltas();
    expect(socket.sent).toHaveLength(1);
  });

  it('waits for every overlapping delivery suspension before flushing', () => {
    const { socket, connection } = build();
    connection.queueDelta(action('issue_a', 41, 'restricted'));
    connection.suspendDeltaFlush();
    connection.suspendDeltaFlush();

    connection.resumeDeltaFlush(() => true);
    connection.flushDeltas();
    expect(socket.sent).toHaveLength(0);

    connection.resumeDeltaFlush(() => true);
    connection.flushDeltas();
    expect(socket.sent).toHaveLength(1);
  });

  it('drops a connection whose outbound buffer exceeds the threshold', () => {
    const { socket, connection } = build({ maxBufferedBytes: 16 });
    socket.buffered = 17;
    connection.send({ type: 'pong', at: new Date().toISOString() });

    expect(socket.sent).toHaveLength(0);
    expect(socket.terminated).toBe(true);
  });

  it('caps the number of subscriptions per connection and reports the overflow', () => {
    const { connection } = build({ maxSubscriptions: 2 });
    expect(connection.addScopes(['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);
    expect(connection.subscriptionCount).toBe(2);
  });

  it('never counts a scope it already holds against the cap', () => {
    const { connection } = build({ maxSubscriptions: 2 });
    connection.addScopes(['a', 'b']);
    expect(connection.addScopes(['a', 'b'])).toEqual([]);
    expect(connection.subscriptionCount).toBe(2);
  });

  it('drops an action the client already applied and keeps the newer one', () => {
    const { socket, connection } = build();
    connection.advanceWatermark(20);
    connection.queueDelta(action('issue_old', 20, 'already seen'));
    connection.queueDelta(action('issue_new', 21, 'fresh'));
    connection.flushDeltas();

    const message = JSON.parse(socket.sent[0] ?? '{}');
    expect(message.actions.map((entry: SyncAction) => entry.modelId)).toEqual(['issue_new']);
  });

  it('never lets the watermark move backwards', () => {
    const { socket, connection } = build();
    connection.advanceWatermark(30);
    connection.advanceWatermark(5);
    connection.queueDelta(action('issue_stale', 12, 'stale'));
    connection.flushDeltas();
    expect(socket.sent).toHaveLength(0);
  });

  it('spends one token per message and refills over time', () => {
    const { connection } = build({ messageBurst: 2, messagesPerSecond: 4 });
    const start = 1_000;
    expect(connection.takeToken(start)).toBe(true);
    expect(connection.takeToken(start)).toBe(true);
    expect(connection.takeToken(start)).toBe(false);
    expect(connection.takeToken(start + 250)).toBe(true);
  });

  it('announces throttling once until the connection recovers', () => {
    const { connection } = build();
    expect(connection.announceThrottled()).toBe(true);
    expect(connection.announceThrottled()).toBe(false);
    connection.clearThrottle();
    expect(connection.announceThrottled()).toBe(true);
  });

  it('only matches actions from its own organization', () => {
    const { connection } = build();
    connection.addScopes(['team:team_1']);
    expect(connection.matches(['team:team_1'], 'org_1')).toBe(true);
    expect(connection.matches(['team:team_1'], 'org_2')).toBe(false);
    expect(connection.matches(['team:team_9'], 'org_1')).toBe(false);
  });
});
