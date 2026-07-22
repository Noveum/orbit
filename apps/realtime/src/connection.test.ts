import type { SyncAction } from '@orbit/shared/events';
import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { ConnectionPrincipal } from './auth.ts';
import { Connection, type ConnectionLimits } from './connection.ts';

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
    ...overrides,
  };
  const connection = new Connection('conn_1', socket as unknown as WebSocket, principal, limits);
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

  it('caps the number of subscriptions per connection', () => {
    const { connection } = build({ maxSubscriptions: 2 });
    connection.addScopes(['a', 'b', 'c', 'd']);
    expect(connection.subscriptionCount).toBe(2);
  });

  it('only matches actions from its own organization', () => {
    const { connection } = build();
    connection.addScopes(['team:team_1']);
    expect(connection.matches(['team:team_1'], 'org_1')).toBe(true);
    expect(connection.matches(['team:team_1'], 'org_2')).toBe(false);
    expect(connection.matches(['team:team_9'], 'org_1')).toBe(false);
  });
});
