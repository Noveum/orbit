import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHmac, randomUUID } from 'node:crypto';
import { db, eq, inArray, schema } from '@orbit/db';
import { createRealtimeHub, type RealtimeHub } from '@orbit/realtime-server';
import { SESSION_REVOKED_CLOSE_CODE } from '@orbit/shared/events';
import { REALTIME_TICKET_TTL_MS, signRealtimeTicket } from '@orbit/shared/events/ticket';
import { POST as authPost } from '../../../src/app/api/auth/[...all]/route.ts';
import { auth } from '../../../src/lib/auth/server.ts';

const APP_ORIGIN = 'http://localhost:3001';

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  closedWith: { code: number; reason: string } | undefined;

  send(payload: string): void {
    this.sent.push(payload);
  }

  bufferedAmount(): number {
    return 0;
  }

  terminate(): void {
    this.readyState = 3;
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  pings = 0;

  ping(): void {
    this.pings += 1;
  }
}

let hub: RealtimeHub;
let organizationId = '';
const seededUserIds: string[] = [];

beforeAll(async () => {
  organizationId = `org_${randomUUID()}`;
  await db
    .insert(schema.organization)
    .values({ id: organizationId, name: 'Sign out', slug: organizationId });
  hub = await createRealtimeHub({
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
    ticketSecret: process.env['BETTER_AUTH_SECRET'] ?? '',
  });
});

afterAll(async () => {
  await hub.close();
  await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  if (seededUserIds.length > 0) {
    await db.delete(schema.user).where(inArray(schema.user.id, seededUserIds));
  }
});

interface SignedIn {
  readonly userId: string;
  readonly sessionId: string;
  readonly cookie: string;
}

async function signIn(existingUserId?: string): Promise<SignedIn> {
  const context = await auth.$context;
  const userId = existingUserId ?? `user_${randomUUID()}`;
  const sessionId = `session_${randomUUID()}`;
  const token = `token_${randomUUID()}`;
  if (existingUserId === undefined) {
    await db.insert(schema.user).values({
      id: userId,
      name: 'Sign Out',
      email: `${userId}@orbit.test`,
      handle: userId,
      emailVerified: true,
    });
    await db
      .insert(schema.member)
      .values({ id: `member_${randomUUID()}`, organizationId, userId, role: 'member' });
    seededUserIds.push(userId);
  }
  await db.insert(schema.session).values({
    id: sessionId,
    token,
    userId,
    activeOrganizationId: organizationId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });

  const signature = createHmac('sha256', context.secret).update(token).digest('base64');
  const value = encodeURIComponent(`${token}.${signature}`);
  const cookie = `${context.authCookies.sessionToken.name}=${value}`;

  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (session?.user.id !== userId) throw new Error('the seeded session cookie is not usable');

  return { userId, sessionId, cookie };
}

async function openSocket(member: SignedIn): Promise<FakeSocket> {
  const socket = new FakeSocket();
  const session = hub.accept(socket);
  session.message(
    JSON.stringify({
      type: 'auth',
      ticket: signRealtimeTicket(
        {
          userId: member.userId,
          organizationId,
          sessionId: member.sessionId,
          exp: Date.now() + REALTIME_TICKET_TTL_MS,
        },
        process.env['BETTER_AUTH_SECRET'] ?? '',
      ),
    }),
  );
  await settle(() => socket.sent.length > 0);
  expect(socket.sent.map((raw) => JSON.parse(raw).type)).toContain('ready');
  return socket;
}

async function settle(done: () => boolean, attempts = 60): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.userId, userId));
  return rows.length;
}

function authRequest(path: string, cookie: string): Request {
  const request = new Request(`${APP_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  request.headers.set('cookie', cookie);
  return request;
}

function signOutRequest(cookie: string): Request {
  return authRequest('/api/auth/sign-out', cookie);
}

describe('signing out closes the socket that session opened', () => {
  it('drops the live connection as soon as the session row is deleted', async () => {
    const member = await signIn();
    const socket = await openSocket(member);
    expect(await sessionCount(member.userId)).toBe(1);

    const response = await authPost(signOutRequest(member.cookie));
    expect(response.status).toBe(200);
    expect(await sessionCount(member.userId)).toBe(0);

    await settle(() => socket.closedWith !== undefined);
    expect(socket.closedWith?.code).toBe(SESSION_REVOKED_CLOSE_CODE);
    expect(hub.stats().connections).toBe(0);
  });

  it('leaves the sockets of everybody else alone', async () => {
    const leaving = await signIn();
    const staying = await signIn();
    const leavingSocket = await openSocket(leaving);
    const stayingSocket = await openSocket(staying);

    await authPost(signOutRequest(leaving.cookie));

    await settle(() => leavingSocket.closedWith !== undefined);
    expect(leavingSocket.closedWith?.code).toBe(SESSION_REVOKED_CLOSE_CODE);
    expect(stayingSocket.closedWith).toBeUndefined();
    expect(await sessionCount(staying.userId)).toBe(1);
  });

  it('keeps a socket whose session survives a sign out on another device', async () => {
    const member = await signIn();
    const socket = await openSocket(member);
    const otherDevice = await signIn(member.userId);

    await authPost(signOutRequest(otherDevice.cookie));

    await settle(() => socket.closedWith !== undefined, 10);
    expect(socket.closedWith).toBeUndefined();
    expect(await sessionCount(member.userId)).toBe(1);
  });
});
