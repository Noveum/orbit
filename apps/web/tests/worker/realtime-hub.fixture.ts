import { mock, spyOn } from 'bun:test';
import assert from 'node:assert/strict';
import type { WebSocket as WorkerSocket } from '@cloudflare/workers-types/index.ts';

mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown) {}
  },
}));

process.env['DATABASE_URL'] = 'postgres://test:test@127.0.0.1:1/orbit_test_rts';
process.env['BETTER_AUTH_SECRET'] = 'x'.repeat(32);
const { RealtimeHubObject } = await import('../../worker/realtime-hub.ts');
const auth = await import('../../../../packages/realtime-server/src/auth.ts');
const { MAX_BUFFERED_BYTES, SESSION_SWEEP_INTERVAL_MS } = await import('@orbit/realtime-server');

const snapshots = new Map<string, unknown>();
const sent: string[] = [];
const closures: [number, string][] = [];
const socket = {
  readyState: 1,
  bufferedAmount: 0,
  deserializeAttachment: () => ({ id: 'reader' }),
  send: (data: string) => sent.push(data),
  close: (code: number, reason: string) => closures.push([code, reason]),
};
const context = {
  storage: {
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve(new Map([...snapshots].filter(([key]) => key.startsWith(prefix)))),
    get: (key: string) => Promise.resolve(snapshots.get(key)),
    put: (key: string, value: unknown) => {
      snapshots.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => Promise.resolve(snapshots.delete(key)),
    setAlarm: () => Promise.resolve(),
  },
  getWebSockets: () => [socket],
  waitUntil: (pending: Promise<unknown>) => pending,
};
const fresh = (): InstanceType<typeof RealtimeHubObject> =>
  Reflect.construct(RealtimeHubObject, [context, {}]);
const restore = (): void => {
  snapshots.set('connection:reader', {
    id: 'reader',
    principal: {
      userId: 'user',
      sessionId: 'session',
      name: 'Reader',
      image: null,
      organizationId: 'org',
      role: 'member',
      teamIds: [],
    },
    scopes: [],
    watermark: 0,
  });
};

const binary = new TextEncoder().encode(JSON.stringify({ type: 'ping' })).buffer;
const workerSocket = socket as unknown as WorkerSocket;
restore();
await fresh().webSocketMessage(workerSocket, binary);
assert.deepEqual(closures.pop(), [1003, 'text_frames_required']);
assert.equal(sent.length, 0);
const worker = fresh();
await worker.webSocketMessage(workerSocket, JSON.stringify({ type: 'ping' }));
assert.equal(JSON.parse(sent.pop() ?? 'null')?.type, 'pong');
socket.bufferedAmount = MAX_BUFFERED_BYTES + 1;
await worker.webSocketMessage(workerSocket, JSON.stringify({ type: 'ping' }));
assert.deepEqual(closures.pop(), [1011, 'terminated']);
assert.equal(sent.length, 0);

restore();
socket.bufferedAmount = 0;
let now = Date.now();
spyOn(Date, 'now').mockImplementation(() => now);
const sessions = spyOn(auth, 'liveSessionIds')
  .mockRejectedValueOnce(new Error('temporarily unavailable'))
  .mockResolvedValue(new Set(['session']));
await fresh().alarm();
assert.equal(sessions.mock.calls.length, 1);
now += 30_000;
await fresh().alarm();
assert.equal(sessions.mock.calls.length, 2);
now += SESSION_SWEEP_INTERVAL_MS / 2;
await fresh().alarm();
assert.equal(sessions.mock.calls.length, 2);
now += SESSION_SWEEP_INTERVAL_MS / 2;
await fresh().alarm();
assert.equal(sessions.mock.calls.length, 3);
