import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PresenceMessage, ServerMessage, SyncAction } from '@orbit/shared/events';
import { ORGANIZATION_FORBIDDEN_CLOSE_CODE, UNAUTHORIZED_CLOSE_CODE } from '@orbit/shared/events';
import { createRealtimeClient, type RealtimeStatus } from './index.ts';

type CloseHandler = ((event: { code: number }) => void) | null;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: CloseHandler = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code = 1000): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function subscribesOf(
  socket: FakeWebSocket | undefined,
): { scopes: string[]; since: number | undefined }[] {
  return (socket?.sent ?? [])
    .map((payload) => JSON.parse(payload) as { type: string; scopes: string[]; since?: number })
    .filter((message) => message.type === 'subscribe')
    .map(({ scopes, since }) => ({ scopes, since }));
}

function delta(syncId: number): SyncAction {
  return {
    syncId,
    organizationId: 'org_1',
    scopes: ['team:team_1'],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { id: 'issue_1', syncId },
    actor: { type: 'user', id: 'user_1' },
    at: '2026-01-01T00:00:00.000Z',
  };
}

describe('realtime client lifecycle', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    FakeWebSocket.instances = [];
  });

  it('treats an unauthorized close as terminal and never reconnects', async () => {
    const statuses: RealtimeStatus[] = [];
    const client = createRealtimeClient({
      url: 'ws://localhost:3100',
      token: 'token_1',
      organizationId: 'org_1',
      maxBackoffMs: 10,
      onStatus: (status) => statuses.push(status),
    });

    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.close(UNAUTHORIZED_CLOSE_CODE);
    await wait(60);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.status()).toBe('closed');
    expect(statuses.filter((status) => status === 'reconnecting')).toHaveLength(0);
    client.close();
  });

  it('treats a forbidden organization close as terminal too', async () => {
    const client = createRealtimeClient({
      url: 'ws://localhost:3100',
      token: 'token_1',
      organizationId: 'org_1',
      maxBackoffMs: 10,
    });

    FakeWebSocket.instances[0]?.open();
    FakeWebSocket.instances[0]?.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE);
    await wait(60);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.status()).toBe('closed');
    client.close();
  });

  it('reconnects after a transient close, resends the watermark and asks for catch up', async () => {
    const resumes: number[] = [];
    const client = createRealtimeClient({
      url: 'ws://localhost:3100',
      token: 'token_1',
      organizationId: 'org_1',
      maxBackoffMs: 10,
      onResume: (since) => resumes.push(since),
    });

    const first = FakeWebSocket.instances[0];
    first?.open();
    client.subscribe(['team:team_1']);
    first?.deliver({ type: 'delta', actions: [delta(70), delta(64)] });
    expect(client.seen()).toBe(70);
    expect(resumes).toHaveLength(0);

    first?.close(1006);
    await wait(60);

    const second = FakeWebSocket.instances[1];
    expect(second).toBeDefined();
    second?.open();

    expect(subscribesOf(second)).toEqual([{ scopes: ['team:team_1'], since: 70 }]);
    expect(resumes).toEqual([70]);
    client.close();
  });

  it('drops a scope the server denied so a later reconnect stops asking for it', async () => {
    const denied: string[][] = [];
    const client = createRealtimeClient({
      url: 'ws://localhost:3100',
      token: 'token_1',
      organizationId: 'org_1',
      maxBackoffMs: 10,
      onDenied: (scopes) => denied.push(scopes),
    });

    const first = FakeWebSocket.instances[0];
    first?.open();
    client.subscribe(['team:team_1', 'team:not_mine']);
    first?.deliver({ type: 'subscribed', scopes: ['team:team_1'], denied: ['team:not_mine'] });
    expect(denied).toEqual([['team:not_mine']]);

    first?.close(1006);
    await wait(60);
    const second = FakeWebSocket.instances[1];
    second?.open();

    expect(subscribesOf(second)).toEqual([{ scopes: ['team:team_1'], since: 0 }]);
    client.close();
  });

  it('reports presence messages without advancing the delta watermark', () => {
    const presence: PresenceMessage[][] = [];
    const client = createRealtimeClient({
      url: 'ws://localhost:3100',
      token: 'token_1',
      organizationId: 'org_1',
      onPresence: (messages) => presence.push(messages),
    });

    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.deliver({
      type: 'presence',
      messages: [
        {
          organizationId: 'org_1',
          scope: 'issue:issue_1',
          kind: 'viewing',
          userId: 'user_2',
          name: 'Grace',
          image: null,
          at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(presence).toHaveLength(1);
    expect(client.seen()).toBe(0);
    client.close();
  });
});
