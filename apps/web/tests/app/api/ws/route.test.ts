import { afterEach, describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

type Attach = (socket: unknown) => void;

const captured: { attach: Attach | null } = { attach: null };

mock.module('@vercel/functions', () => ({
  experimental_upgradeWebSocket: (attach: Attach) => {
    captured.attach = attach;
    return Promise.resolve(new Response(null, { status: 101 }));
  },
}));

const realtimeServer = await import('@orbit/realtime-server');
mock.module('@orbit/realtime-server', () => ({
  ...realtimeServer,
  fromNodeSocket: (socket: unknown) => socket,
}));

const hubResult: { value: Promise<unknown> } = { value: Promise.resolve(null) };
mock.module('@/lib/realtime/hub.ts', () => ({
  realtimeHub: () => hubResult.value,
  redisConfigured: () => true,
}));

const { GET } = await import('../../../../src/app/api/ws/route.ts');

class FakeWebSocket extends EventEmitter {
  readonly closures: { code: number; reason: string }[] = [];

  close(code: number, reason: string): void {
    this.closures.push({ code, reason });
  }
}

interface SessionLog {
  readonly messages: string[];
  pongs: number;
  closes: number;
}

function fakeHub(log: SessionLog) {
  return {
    accept: () => ({
      message: (raw: string) => {
        log.messages.push(raw);
      },
      pong: () => {
        log.pongs += 1;
      },
      closed: () => {
        log.closes += 1;
      },
    }),
    stats: () => ({ connections: 1, subscriptions: 0, redis: 'ready' }),
    close: () => Promise.resolve(),
  };
}

function newLog(): SessionLog {
  return { messages: [], pongs: 0, closes: 0 };
}

function takeAttach(): Attach {
  const attach = captured.attach;
  if (attach === null) throw new Error('the route never handed a socket handler to the upgrade');
  return attach;
}

async function attachSocket(socket: FakeWebSocket): Promise<void> {
  captured.attach = null;
  const response = await GET();
  expect(response.status).toBe(101);
  takeAttach()(socket);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await new Promise(setImmediate);
}

afterEach(() => {
  hubResult.value = Promise.resolve(null);
});

describe('GET /api/ws', () => {
  it('upgrades first and replays the frames buffered before the hub answered, in order', async () => {
    const log = newLog();
    let release: (value: unknown) => void = () => undefined;
    hubResult.value = new Promise((resolve) => {
      release = resolve;
    });

    const socket = new FakeWebSocket();
    await attachSocket(socket);

    socket.emit('message', Buffer.from('one'));
    socket.emit('message', Buffer.from('two'));
    socket.emit('message', Buffer.from('three'));
    expect(log.messages).toEqual([]);

    release(fakeHub(log));
    await settle();

    expect(log.messages).toEqual(['one', 'two', 'three']);

    socket.emit('message', Buffer.from('four'));
    expect(log.messages).toEqual(['one', 'two', 'three', 'four']);
    expect(socket.closures).toEqual([]);
  });

  it('closes with 1008 on the thirty third frame that arrives before the hub is ready', async () => {
    const log = newLog();
    let release: (value: unknown) => void = () => undefined;
    hubResult.value = new Promise((resolve) => {
      release = resolve;
    });

    const socket = new FakeWebSocket();
    await attachSocket(socket);

    for (let index = 0; index < 32; index += 1) {
      socket.emit('message', Buffer.from(`frame-${index}`));
    }
    expect(socket.closures).toEqual([]);

    socket.emit('message', Buffer.from('frame-32'));
    expect(socket.closures).toEqual([{ code: 1008, reason: 'too_many_frames_before_ready' }]);

    release(fakeHub(log));
    await settle();

    expect(log.messages).toHaveLength(32);
    expect(log.messages.at(-1)).toBe('frame-31');
  });

  it('closes with 1011 when the hub never comes up', async () => {
    hubResult.value = Promise.reject(new Error('redis is unreachable'));

    const socket = new FakeWebSocket();
    await attachSocket(socket);
    socket.emit('message', Buffer.from('queued'));
    await settle();

    expect(socket.closures).toEqual([{ code: 1011, reason: 'realtime_unavailable' }]);
  });

  it('never attaches a session to a socket that closed while the hub was starting', async () => {
    const log = newLog();
    let release: (value: unknown) => void = () => undefined;
    hubResult.value = new Promise((resolve) => {
      release = resolve;
    });

    const socket = new FakeWebSocket();
    await attachSocket(socket);
    socket.emit('message', Buffer.from('early'));
    socket.emit('close');

    release(fakeHub(log));
    await settle();

    expect(log.messages).toEqual([]);
    socket.emit('message', Buffer.from('late'));
    expect(log.messages).toEqual([]);
  });

  it('forwards a pong to the session once it exists and ignores it before that', async () => {
    const log = newLog();
    let release: (value: unknown) => void = () => undefined;
    hubResult.value = new Promise((resolve) => {
      release = resolve;
    });

    const socket = new FakeWebSocket();
    await attachSocket(socket);
    socket.emit('pong');
    expect(log.pongs).toBe(0);

    release(fakeHub(log));
    await settle();

    socket.emit('pong');
    expect(log.pongs).toBe(1);

    socket.emit('close');
    expect(log.closes).toBe(1);
  });
});
