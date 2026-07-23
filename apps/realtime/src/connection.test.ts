import { describe, expect, it } from 'bun:test';
import type { SyncAction } from '@orbit/shared/events';
import type { ServerWebSocket } from 'bun';
import type { ConnectionPrincipal } from './auth.ts';
import { Connection, type ConnectionLimits, type SocketData } from './connection.ts';

const principal: ConnectionPrincipal = {
  userId: 'user_1',
  name: 'Ada',
  image: null,
  organizationId: 'org_1',
  role: 'member',
  teamIds: ['team_1'],
};

class FakeSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  terminated = false;
  pings = 0;
  closedWith: { code: number; reason: string } | undefined;

  send(payload: string): void {
    this.sent.push(payload);
  }

  getBufferedAmount(): number {
    return this.bufferedAmount;
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
  const connection = new Connection(
    'conn_1',
    socket as unknown as ServerWebSocket<SocketData>,
    principal,
    limits,
  );
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

  it('drops a connection whose outbound buffer exceeds the threshold', () => {
    const { socket, connection } = build({ maxBufferedBytes: 16 });
    socket.bufferedAmount = 17;
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
