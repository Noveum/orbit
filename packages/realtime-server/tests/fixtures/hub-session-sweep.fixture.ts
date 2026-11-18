import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { z } from 'zod';
import type { ConnectionPrincipal } from '../../src/auth.ts';
import { FakeRedis } from '../fake-redis.ts';
import { FakeSocket, settle, waitFor } from '../fake-socket.ts';

const mode = z.enum(['serial', 'manual', 'close', 'removed', 'terminal']).parse(process.argv[2]);
let network = 0;
const deny = (): never => {
  network += 1;
  throw new Error('This fixture must not access a network');
};
net.connect = deny;
net.createConnection = deny;
net.Socket.prototype.connect = deny;
tls.connect = deny;
globalThis.fetch = Object.assign(deny, { preconnect: deny });

let nextSession = 'stale-session';
let calls = 0;
let active = 0;
let maximumActive = 0;
let release: ((value: Set<string>) => void) | undefined;
const pending = new Promise<Set<string>>((resolve) => {
  release = resolve;
});
const errors: string[] = [];

function principal(): ConnectionPrincipal {
  return {
    userId: nextSession,
    sessionId: nextSession,
    name: 'Local fixture',
    image: null,
    organizationId: 'local-home',
    role: 'member',
    teamIds: ['local-team'],
  };
}

mock.module('@orbit/db', () => {
  throw new Error('The sweep fixture must not import a real database');
});
mock.module('ioredis', () => ({ Redis: FakeRedis }));
mock.module('../../src/logger.ts', () => ({
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => errors.push(message),
  },
  errorFields: () => ({}),
}));
mock.module('../../src/auth.ts', () => ({
  authenticateTicket: async () => ({ ok: true, principal: principal() }),
  authorizedIssueTeamId: async () => 'local-team',
  authorizeScope: async () => true,
  issueReachInOrganization: async () => ({ teamId: 'local-team', syncId: 1 }),
  issueTeamIdInOrganization: async () => 'local-team',
  liveSessionIds: async () => {
    calls += 1;
    if (mode === 'terminal' && calls === 1) throw new Error('fixture terminal read failure');
    if (mode === 'terminal') return new Set(['stale-session', 'fresh-session']);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    try {
      return await pending;
    } finally {
      active -= 1;
    }
  },
  memberDeleteSchema: z.object({ userId: z.string() }),
  membershipStillValid: async () => true,
  readTicketFrame: () => ({}),
  refreshedPrincipal: async () => principal(),
  sessionStillValid: async () => true,
}));

const { createRealtimeHub } = await import('../../src/hub.ts');
const hub = await createRealtimeHub({
  redisUrl: 'redis://fake:6379',
  ticketSecret: 'local-session-sweep-fixture',
  heartbeatIntervalMs: 5,
  heartbeatTimeoutMs: 60_000,
  sessionSweepIntervalMs: 5,
  scheduling: mode === 'manual' ? 'manual' : 'intervals',
});
let closed = false;
const sessions = new Map<string, ReturnType<typeof hub.accept>>();

async function connect(id: string): Promise<FakeSocket> {
  nextSession = id;
  const socket = new FakeSocket();
  const session = hub.accept(socket);
  sessions.set(id, session);
  session.message('{}');
  await waitFor(() => socket.frames('ready').length === 1, 'local authentication');
  return socket;
}

try {
  const stale = await connect('stale-session');
  const fresh = await connect('fresh-session');
  const manual = mode === 'manual' ? [hub.sweepSessions(), hub.sweepSessions()] : [];
  await waitFor(() => calls >= 1, 'the first session read');
  if (mode === 'manual') {
    assert.equal(calls, 1);
    assert.equal(maximumActive, 1);
    stale.close(1000, 'client_closed');
    sessions.get('stale-session')?.closed();
    assert(release !== undefined);
    release(new Set(['fresh-session']));
    await Promise.all(manual);
    assert.deepEqual(stale.closures, [{ code: 1000, reason: 'client_closed' }]);
    assert.equal(stale.terminated, 0);
    assert.deepEqual(fresh.closures, []);
    assert.equal(hub.stats().connections, 1);
    await hub.sweepSessions();
    assert.equal(calls, 2);
  } else if (mode === 'serial') {
    const observed = fresh.pings;
    await waitFor(() => fresh.pings >= observed + 4, 'multiple timer turns during the read');
    assert.equal(maximumActive, 1, 'A pending session sweep must not overlap later timer turns');
    assert(release !== undefined);
    release(new Set(['fresh-session']));
    await waitFor(() => stale.closures.length === 1, 'the expired session closure');
    assert.deepEqual(stale.closures, [{ code: 4002, reason: 'session_revoked' }]);
    assert.deepEqual(fresh.closures, []);
    await waitFor(() => calls >= 2, 'a later sweep after the pending read settles');
  } else if (mode === 'close') {
    await hub.close();
    closed = true;
    assert(release !== undefined);
    release(new Set());
    await settle(20);
    assert.deepEqual(stale.closures, [{ code: 1001, reason: 'server shutting down' }]);
    assert.deepEqual(fresh.closures, [{ code: 1001, reason: 'server shutting down' }]);
    assert.equal(stale.terminated, 0);
    assert.equal(fresh.terminated, 0);
    assert.equal(hub.stats().connections, 0);
  } else if (mode === 'removed') {
    stale.close(1000, 'client_closed');
    sessions.get('stale-session')?.closed();
    assert(release !== undefined);
    release(new Set(['fresh-session']));
    await settle(20);
    assert.equal(stale.terminated, 0);
    assert.deepEqual(stale.closures, [{ code: 1000, reason: 'client_closed' }]);
    assert.deepEqual(fresh.closures, []);
    assert.equal(hub.stats().connections, 1);
  } else {
    await waitFor(() => errors.length === 1, 'the terminal read failure to be logged');
    assert.deepEqual(stale.closures, []);
    assert.deepEqual(fresh.closures, []);
    await waitFor(() => calls >= 2, 'the ordinary next sweep after a terminal failure');
    assert.deepEqual(stale.closures, []);
    assert.deepEqual(fresh.closures, []);
  }
  assert.equal(errors.length, mode === 'terminal' ? 1 : 0);
  assert.equal(network, 0);
  console.log(JSON.stringify({ completed: true, mode, maximumActive, network }));
} finally {
  release?.(new Set(['fresh-session']));
  if (!closed) await hub.close();
  await settle(4);
}
