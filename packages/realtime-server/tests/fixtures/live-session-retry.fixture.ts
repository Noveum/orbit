import assert from 'node:assert/strict';
import net, { type Socket } from 'node:net';
import { z } from 'zod';

const mode = z.enum(['recover', 'expire', 'bounded', 'permission', 'empty']).parse(process.argv[2]);
const sessionId = 'fixture-live-session';
const sockets = new Set<Socket>();
const startupSqlFrames: number[] = [];
let connections = 0;
let deniedConnections = 0;
let externalFetches = 0;
let expiresAt = Number.POSITIVE_INFINITY;
let selectedCutoff = 0;
let peerPort = 0;
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: Socket, ...args: unknown[]): Socket {
  if (args[0] !== peerPort || args[1] !== '127.0.0.1' || peerPort === 0) {
    deniedConnections += 1;
    throw new Error('Only the owned loopback peer is allowed');
  }
  Reflect.apply(originalConnect, this, args);
  return this;
};
globalThis.fetch = Object.assign(
  () => {
    externalFetches += 1;
    return Promise.reject(new Error('External fetch is forbidden'));
  },
  {
    preconnect: () => {
      externalFetches += 1;
      throw new Error('External preconnect is forbidden');
    },
  },
);

function int16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeInt16BE(value);
  return bytes;
}

function int32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
}

function frame(type: string, bytes: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([Buffer.from(type), int32(bytes.length + 4), bytes]);
}

function ready(): Buffer {
  return frame('Z', Buffer.from('I'));
}

function columns(): Buffer {
  return frame(
    'T',
    Buffer.concat([
      int16(1),
      Buffer.from('id\0'),
      int32(0),
      int16(0),
      int32(25),
      int16(-1),
      int32(-1),
      int16(0),
    ]),
  );
}

function readParameters(bytes: Buffer): string[] {
  let offset = bytes.indexOf(0) + 1;
  offset = bytes.indexOf(0, offset) + 1;
  const formats = bytes.readInt16BE(offset);
  offset += 2 + formats * 2;
  const count = bytes.readInt16BE(offset);
  offset += 2;
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = bytes.readInt32BE(offset);
    offset += 4;
    assert(length >= 0);
    values.push(bytes.subarray(offset, offset + length).toString());
    offset += length;
  }
  return values;
}

const server = net.createServer((socket) => {
  connections += 1;
  const connectionNumber = connections;
  startupSqlFrames.push(0);
  sockets.add(socket);
  socket.on('error', () => undefined);
  socket.on('close', () => sockets.delete(socket));
  let buffer: Buffer = Buffer.alloc(0);
  let started = false;
  let parameters: string[] = [];
  let parameterCount = 0;
  const healthy = mode === 'permission' || connectionNumber > 1;
  socket.on('data', (bytes: Buffer) => {
    buffer = Buffer.concat([buffer, bytes]);
    for (;;) {
      if (!started) {
        if (buffer.length < 4) return;
        const length = buffer.readInt32BE(0);
        assert(length >= 8 && length <= 65536);
        if (buffer.length < length) return;
        assert.equal(buffer.readInt32BE(4), 196608);
        buffer = buffer.subarray(length);
        started = true;
        if (mode === 'expire' && connectionNumber === 1) expiresAt = Date.now() + 10;
        if (healthy && mode !== 'bounded') {
          socket.write(Buffer.concat([frame('R', int32(0)), ready()]));
        }
      }
      if (buffer.length < 5) return;
      const length = buffer.readInt32BE(1);
      assert(length >= 4 && length <= 65536);
      if (buffer.length < length + 1) return;
      const type = String.fromCharCode(buffer[0] ?? 0);
      const payload = buffer.subarray(5, length + 1);
      buffer = buffer.subarray(length + 1);
      if (['Q', 'P', 'B', 'E'].includes(type)) {
        startupSqlFrames[connectionNumber - 1] = (startupSqlFrames[connectionNumber - 1] ?? 0) + 1;
      }
      if (!healthy || mode === 'bounded') continue;
      if (type === 'P') {
        const query =
          payload
            .subarray(payload.indexOf(0) + 1)
            .toString()
            .split('\0')[0] ?? '';
        assert(query.startsWith('select '));
        assert(query.includes('"session"."expires_at" >'));
        parameterCount = Math.max(
          ...Array.from(query.matchAll(/\$(\d+)/g), (value) => Number(value[1])),
        );
        socket.write(frame('1'));
      } else if (type === 'D') {
        socket.write(
          Buffer.concat([
            frame(
              't',
              Buffer.concat([
                int16(parameterCount),
                ...Array.from({ length: parameterCount }, (_, index) =>
                  int32(index === parameterCount - 1 ? 1184 : 25),
                ),
              ]),
            ),
            columns(),
          ]),
        );
      } else if (type === 'B') {
        parameters = readParameters(payload);
        socket.write(frame('2'));
      } else if (type === 'E') {
        if (mode === 'permission') {
          socket.write(frame('E', Buffer.from('SERROR\0C42501\0Mfixture denied\0\0')));
          continue;
        }
        assert.equal(parameters.filter((value) => value === sessionId).length, 1);
        selectedCutoff = Date.parse(parameters.at(-1) ?? 'invalid');
        assert(Number.isFinite(selectedCutoff));
        const rows =
          selectedCutoff < expiresAt
            ? [
                frame(
                  'D',
                  Buffer.concat([int16(1), int32(sessionId.length), Buffer.from(sessionId)]),
                ),
              ]
            : [];
        socket.write(Buffer.concat([...rows, frame('C', Buffer.from(`SELECT ${rows.length}\0`))]));
      } else if (type === 'S') {
        socket.write(ready());
      } else if (type === 'X') {
        socket.end();
      } else {
        assert.equal(type, 'H');
      }
    }
  });
});

await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen({ host: '127.0.0.1', port: 0 }, resolve);
});
const address = server.address();
assert(address !== null && typeof address !== 'string');
peerPort = address.port;
process.env['DATABASE_URL'] =
  `postgres://fixture:fixture@127.0.0.1:${peerPort}/orbit_test_session_peer?connect_timeout=0.1&backoff=0&fetch_types=false&max_lifetime=0`;
process.env['DATABASE_POOL_MAX'] = '1';
const { liveSessionIds } = await import('../../src/auth.ts');
const { pool } = await import('@orbit/db');

try {
  if (mode === 'bounded' || mode === 'permission') {
    await assert.rejects(
      () => liveSessionIds([sessionId]),
      (error: unknown) => {
        const native = z.object({ cause: z.object({ code: z.string() }) }).parse(error);
        assert.equal(native.cause.code, mode === 'bounded' ? 'CONNECT_TIMEOUT' : '42501');
        return true;
      },
    );
    assert.equal(connections, mode === 'bounded' ? 2 : 1);
  } else {
    const live = await liveSessionIds(mode === 'empty' ? [] : [sessionId, sessionId]);
    assert.deepEqual([...live], mode === 'recover' ? [sessionId] : []);
    assert.equal(connections, mode === 'empty' ? 0 : 2);
    if (mode === 'expire') assert(selectedCutoff >= expiresAt);
  }
  if (connections > 1) assert.equal(startupSqlFrames[0], 0);
  assert.equal(deniedConnections, 0);
  assert.equal(externalFetches, 0);
  console.log(
    JSON.stringify({
      completed: true,
      mode,
      connections,
      startupSqlFrames,
      deniedConnections,
      externalFetches,
      realDatabaseConnections: 0,
    }),
  );
} finally {
  await pool.end({ timeout: 0 });
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  net.Socket.prototype.connect = originalConnect;
}
