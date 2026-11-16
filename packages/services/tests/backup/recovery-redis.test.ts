import { describe, expect, it } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { verifyRedisRealtimeAfterEmpty } from '../../src/backup/recovery-drill.ts';

async function createRedisPeer(stalledCommand: string) {
  const sockets = new Set<Socket>();
  const subscribers = new Map<Socket, boolean>();
  const commands: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let pending = '';
    let resp3 = false;
    socket.on('data', (data) => {
      pending += data.toString();
      while (pending.length > 0) {
        const lines = pending.split('\r\n');
        const count = Number(lines[0]?.slice(1));
        if (!Number.isInteger(count) || lines.length < 2 * count + 2) return;
        const args = Array.from({ length: count }, (_, index) => lines[2 * index + 2] ?? '');
        pending = lines.slice(2 * count + 1).join('\r\n');
        const command = args[0]?.toLowerCase() ?? '';
        commands.push(command);
        if (command === stalledCommand) continue;
        if (command === 'hello') {
          resp3 = true;
          socket.write('%1\r\n$5\r\nproto\r\n:3\r\n');
        } else if (command === 'info') {
          const info = 'redis_version:7.0.0\r\nloading:0\r\n';
          socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
        } else if (command === 'dbsize') {
          socket.write(':0\r\n');
        } else if (command === 'subscribe') {
          subscribers.set(socket, resp3);
          socket.write(`${resp3 ? '>3' : '*3'}\r\n$9\r\nsubscribe\r\n$11\r\norbit:delta\r\n:1\r\n`);
        } else if (command === 'publish') {
          const payload = args[2] ?? '';
          for (const [subscriber, subscriberResp3] of subscribers) {
            subscriber.write(
              (subscriberResp3 ? '>3' : '*3') +
                '\r\n$7\r\nmessage\r\n$11\r\norbit:delta\r\n$' +
                Buffer.byteLength(payload) +
                '\r\n' +
                payload +
                '\r\n',
            );
          }
          socket.write(':1\r\n');
        } else {
          socket.write('+OK\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Loopback address missing');
  return {
    url: `redis://127.0.0.1:${address.port}/0`,
    sockets,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('recovery Redis transport and deadlines', () => {
  it('uses TLS on the wire for an uppercase secure Redis URL', async () => {
    const sockets = new Set<Socket>();
    let firstByte: number | undefined;
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.once('data', (data) => {
        firstByte = typeof data === 'string' ? Buffer.from(data)[0] : data[0];
        socket.destroy();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Loopback address missing');
    try {
      await verifyRedisRealtimeAfterEmpty(`REDISS://127.0.0.1:${address.port}/0`);
      expect(firstByte).toBe(0x16);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15000);

  it('verifies a responsive loopback peer and closes its connections', async () => {
    const peer = await createRedisPeer('never');
    try {
      const result = await verifyRedisRealtimeAfterEmpty(peer.url);
      expect(result).toEqual({ valid: true, errors: [] });
      await Bun.sleep(25);
      expect(peer.sockets.size).toBe(0);
    } finally {
      await peer.close();
    }
  });

  it.each(['hello', 'info', 'dbsize', 'quit'])(
    'bounds a stalled %s request and closes every connection',
    async (command) => {
      const peer = await createRedisPeer(command);
      let completed = false;
      const result = verifyRedisRealtimeAfterEmpty(peer.url).then((value) => {
        completed = true;
        return value;
      });
      try {
        await Promise.race([result, Bun.sleep(7500)]);
        expect(peer.commands).toContain(command);
        expect(completed).toBe(true);
        await Bun.sleep(25);
        expect(peer.sockets.size).toBe(0);
        const verification = await result;
        expect(verification.valid).toBe(false);
        if (command === 'quit')
          expect(
            verification.errors.every((error) => error.startsWith('Redis cleanup failed:')),
          ).toBe(true);
      } finally {
        await peer.close();
        await result;
      }
    },
    15000,
  );
});
