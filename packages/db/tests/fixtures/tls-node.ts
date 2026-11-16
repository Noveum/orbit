import { readFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import tls from 'node:tls';

const [mode, certificatePath, keyPath, query, pgssl] = process.argv.slice(2);
if (
  !(mode && certificatePath && keyPath) ||
  process.versions.bun ||
  Number.parseInt(process.versions.node, 10) < 22
) {
  throw new Error('Expected Node 22 or newer and local TLS fixture arguments.');
}
const certificate = readFileSync(certificatePath, 'utf8');
const sockets = new Set<Socket>();
let startupPackets = 0;
let authorized = false;
let serverTls = false;
let completeHandshake: () => void = () => undefined;
const handshake = new Promise<void>((resolve) => {
  completeHandshake = resolve;
});
const originalConnect = tls.connect;
tls.connect = ((...args: Parameters<typeof tls.connect>) => {
  const socket = originalConnect(...args);
  socket.on('secureConnect', () => {
    authorized = socket.authorized;
    completeHandshake();
  });
  return socket;
}) as typeof tls.connect;
const server = createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => undefined);
  socket.once('data', (request) => {
    if (
      typeof request === 'string' ||
      request.length !== 8 ||
      request.readInt32BE(4) !== 80877103
    ) {
      startupPackets += 1;
      socket.destroy();
      return;
    }
    if (mode === 'refused') {
      socket.write('N');
      socket.once('data', (packet) => {
        if (typeof packet !== 'string' && packet.length >= 8 && packet.readInt32BE(4) === 196608) {
          startupPackets += 1;
        }
        socket.destroy();
      });
      return;
    }
    socket.write('S');
    const secure = new tls.TLSSocket(socket, {
      isServer: true,
      secureContext: tls.createSecureContext({ cert: certificate, key: readFileSync(keyPath) }),
    });
    secure.on('error', () => undefined);
    secure.on('secure', () => {
      serverTls = true;
    });
    secure.on('data', () => undefined);
  });
});
const host = '127.0.0.1';
await new Promise<void>((resolve) => server.listen(0, host, resolve));
const address = server.address();
if (typeof address !== 'object' || address === null) throw new Error('Missing local server.');
process.env['DATABASE_URL'] =
  `postgres://fixture:fixture@${mode.endsWith('-ip') ? host : 'localhost'}:${address.port}/orbit_test_tls${query ? `?${query}` : ''}`;
process.env['DATABASE_REQUIRE_TLS'] = 'true';
if (pgssl) process.env['PGSSL'] = pgssl;
if (mode !== 'untrusted') process.env['DATABASE_TLS_CA_PEM'] = certificate;
const { pool } = await import('../../src/client.ts');
let rejected = false;
let failureCode = '';
const queryResult = pool`select 1`.then(
  () => false,
  (error: unknown) => {
    failureCode = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    return true;
  },
);
try {
  await Promise.race([handshake, queryResult]);
} finally {
  await pool.end({ timeout: 0 });
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
rejected = await queryResult;
const verified = mode.startsWith('valid') ? authorized : !authorized;
const ok = verified && rejected && startupPackets === 0;
process.stdout.write(
  JSON.stringify({
    ok,
    authorized,
    serverTls,
    startupPackets,
    failureCode,
    node: process.versions.node,
  }),
);
process.exitCode = ok ? 0 : 1;
