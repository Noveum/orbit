import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import type { RealtimeHub } from '@orbit/realtime-server';
import { WebSocket } from 'ws';
import { createNodeRealtimeServer } from '@/lib/realtime/node-server.ts';

const origin = 'https://orbit.example.com';
let redis = 'ready';
let accepted = 0;
let closed = 0;
const messages: string[] = [];
const hub: RealtimeHub = {
  accept: () => {
    accepted += 1;
    return {
      message: (message) => {
        messages.push(message);
      },
      closed: () => {
        closed += 1;
      },
      pong: () => undefined,
    };
  },
  stats: () => ({ connections: 0, subscriptions: 0, redis }),
  close: () => Promise.resolve(),
};
const server = await createNodeRealtimeServer(hub, { origin });
const base = `http://127.0.0.1:${server.port}`;
function rejected(path: string, offeredOrigin?: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = request(
      `${base}${path}`,
      {
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          ...(offeredOrigin === undefined ? {} : { origin: offeredOrigin }),
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
}
try {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal(await rejected('/api/ws'), 403);
  assert.equal(await rejected('/api/ws', 'https://other.example.com'), 403);
  assert.equal(await rejected('/api/ws', `${origin}.evil.example`), 403);
  assert.equal(await rejected('/other', origin), 404);
  assert.equal(await rejected('/api/ws?ticket=secret', origin), 404);
  assert.equal(accepted, 0);
  redis = 'reconnecting';
  assert.equal((await fetch(`${base}/health`)).status, 503);
  assert.equal(await rejected('/api/ws', origin), 503);
  redis = 'ready';
  const client = new WebSocket(`${base}/api/ws`, { origin });
  await once(client, 'open');
  client.send('{"type":"auth","ticket":"hub-verifies-ticket"}');
  for (let attempts = 0; messages.length === 0 && attempts < 100; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(messages, ['{"type":"auth","ticket":"hub-verifies-ticket"}']);
  client.send(Buffer.from('binary'));
  const [code] = await once(client, 'close');
  assert.equal(code, 1003);
  for (let attempts = 0; closed === 0 && attempts < 100; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(closed, 1);
  assert.equal(messages.length, 1);
} finally {
  await server.close();
}
console.info('All realtime checks passed');
