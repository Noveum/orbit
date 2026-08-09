import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { db, eq, schema } from '@orbit/db';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  SESSION_REVOKED_CLOSE_CODE,
  type SyncAction,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';
import { signRealtimeTicket } from '@orbit/shared/events/ticket';
import { FakeRedis, resetFakeRedis } from './fake-redis.ts';
import { FakeSocket, waitFor } from './fake-socket.ts';
import {
  dropSeededWorkspaces,
  insertSession,
  type SeededWorkspace,
  seedWorkspace,
} from './fixture.ts';

const loggerModule = await import('../src/logger.ts');
mock.module('../src/logger.ts', () => ({
  ...loggerModule,
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
mock.module('ioredis', () => ({ Redis: FakeRedis }));

const { createRealtimeHub } = await import('../src/hub.ts');
type Hub = Awaited<ReturnType<typeof createRealtimeHub>>;

const SECRET = 'a-secret-long-enough-for-the-ticket';
const REDIS_URL = 'redis://fake:6379';

let home: SeededWorkspace;
let away: SeededWorkspace;

beforeAll(async () => {
  home = await seedWorkspace('Hub home');
  away = await seedWorkspace('Hub away');
});

afterAll(async () => {
  await dropSeededWorkspaces();
  resetFakeRedis();
  mock.module('../src/logger.ts', () => loggerModule);
});

async function newHub(overrides: Parameters<typeof createRealtimeHub>[0] = {}): Promise<Hub> {
  return await createRealtimeHub({
    redisUrl: REDIS_URL,
    ticketSecret: SECRET,
    batchWindowMs: 1,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 60_000,
    ...overrides,
  });
}

interface Wired {
  readonly socket: FakeSocket;
  readonly session: ReturnType<Hub['accept']>;
  readonly sessionId: string;
}

async function connect(hub: Hub, userId: string, organizationId: string): Promise<Wired> {
  const { sessionId } = await insertSession(userId, new Date(Date.now() + 600_000));
  const socket = new FakeSocket();
  const session = hub.accept(socket);
  const ticket = signRealtimeTicket(
    { userId, organizationId, sessionId, exp: Date.now() + 60_000 },
    SECRET,
  );
  session.message(JSON.stringify({ type: 'auth', ticket }));
  await waitFor(() => socket.last('ready') !== undefined, `a ready frame for ${userId}`);
  return { socket, session, sessionId };
}

async function subscribe(wired: Wired, scopes: readonly string[]): Promise<void> {
  const before = wired.socket.frames('subscribed').length;
  wired.session.message(JSON.stringify({ type: 'subscribe', scopes }));
  await waitFor(
    () => wired.socket.frames('subscribed').length > before,
    `a subscribed frame for ${scopes.join()}`,
  );
}

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 10,
    organizationId: home.organizationId,
    scopes: [`team:${home.teamCore}`],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { id: 'issue_1' },
    actor: { type: 'user', id: home.adminUserId },
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function driver(): FakeRedis {
  return new FakeRedis(REDIS_URL);
}

async function publishDelta(entry: SyncAction): Promise<void> {
  await driver().publish(REDIS_DELTA_CHANNEL, JSON.stringify([entry]));
}

describe('subscribe is the authorization gate', () => {
  it('accepts the scopes the principal may reach and returns the rest as denied', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);

      await subscribe(wired, [
        `team:${home.teamCore}`,
        `team:${home.teamOther}`,
        `doc:${home.privateDoc}`,
        `doc:${home.docGrantedToReader}`,
        `org:${away.organizationId}`,
      ]);

      const frame = wired.socket.last('subscribed');
      expect(frame?.scopes.sort()).toEqual(
        [`team:${home.teamCore}`, `doc:${home.docGrantedToReader}`].sort(),
      );
      expect(frame?.denied.sort()).toEqual(
        [`team:${home.teamOther}`, `doc:${home.privateDoc}`, `org:${away.organizationId}`].sort(),
      );
      expect(hub.stats().subscriptions).toBe(2);
    } finally {
      await hub.close();
    }
  });

  it('never delivers a delta on a scope it denied', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamOther}`]);

      await publishDelta(action({ scopes: [`team:${home.teamOther}`] }));
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(wired.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('rejects a forged ticket without ever opening a connection', async () => {
    const hub = await newHub();
    try {
      const socket = new FakeSocket();
      const session = hub.accept(socket);
      session.message(JSON.stringify({ type: 'auth', ticket: 'forged.value' }));
      await waitFor(() => socket.closures.length > 0, 'a close after a forged ticket');

      expect(socket.closures[0]?.code).toBe(UNAUTHORIZED_CLOSE_CODE);
      expect(hub.stats().connections).toBe(0);
    } finally {
      await hub.close();
    }
  });
});

describe('delta fan out', () => {
  it('reaches only the connections whose scopes and workspace both match', async () => {
    const hub = await newHub();
    try {
      const onCore = await connect(hub, home.readerUserId, home.organizationId);
      const onAdmin = await connect(hub, home.adminUserId, home.organizationId);
      const elsewhere = await connect(hub, away.readerUserId, away.organizationId);

      await subscribe(onCore, [`team:${home.teamCore}`]);
      await subscribe(onAdmin, [`team:${home.teamOther}`]);
      await subscribe(elsewhere, [`team:${away.teamCore}`]);

      await publishDelta(action({ scopes: [`team:${home.teamCore}`] }));
      await waitFor(() => onCore.socket.frames('delta').length > 0, 'a delta on the core team');
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(onCore.socket.last('delta')?.actions[0]?.modelId).toBe('issue_1');
      expect(onAdmin.socket.frames('delta')).toHaveLength(0);
      expect(elsewhere.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('keeps a matching scope from crossing into another workspace', async () => {
    const hub = await newHub();
    try {
      const elsewhere = await connect(hub, away.readerUserId, away.organizationId);
      await subscribe(elsewhere, [`team:${away.teamCore}`]);

      await publishDelta(
        action({ organizationId: home.organizationId, scopes: [`team:${away.teamCore}`] }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(elsewhere.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('discards a delta that does not parse rather than dropping the connection', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);

      await driver().publish(REDIS_DELTA_CHANNEL, 'not json');
      await driver().publish(REDIS_DELTA_CHANNEL, JSON.stringify([{ model: 'nope' }]));
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wired.socket.frames('delta')).toHaveLength(0);
      expect(wired.socket.closures).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });
});

describe('presence', () => {
  it('reaches the other reader on the scope and never echoes to its author', async () => {
    const hub = await newHub();
    try {
      const author = await connect(hub, home.readerUserId, home.organizationId);
      const watcher = await connect(hub, home.adminUserId, home.organizationId);
      const bystander = await connect(hub, home.adminUserId, home.organizationId);
      const elsewhere = await connect(hub, away.readerUserId, away.organizationId);
      await subscribe(author, [`team:${home.teamCore}`]);
      await subscribe(watcher, [`team:${home.teamCore}`]);
      await subscribe(bystander, [`team:${home.teamOther}`]);
      await subscribe(elsewhere, [`team:${away.teamCore}`]);

      author.session.message(
        JSON.stringify({ type: 'presence', scope: `team:${home.teamCore}`, kind: 'viewing' }),
      );
      await waitFor(
        () => watcher.socket.frames('presence').length > 0,
        'presence to reach the watcher',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(watcher.socket.last('presence')?.messages[0]?.userId).toBe(home.readerUserId);
      expect(author.socket.frames('presence')).toHaveLength(0);
      expect(bystander.socket.frames('presence')).toHaveLength(0);
      expect(elsewhere.socket.frames('presence')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('refuses presence on a scope the principal may not reach', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);

      wired.session.message(
        JSON.stringify({ type: 'presence', scope: `team:${home.teamOther}`, kind: 'typing' }),
      );
      await waitFor(() => wired.socket.frames('error').length > 0, 'a forbidden scope error');

      expect(wired.socket.last('error')?.code).toBe('forbidden_scope');
    } finally {
      await hub.close();
    }
  });
});

describe('a doc delta re-authorizes every reader holding that scope', () => {
  it('drops the scope of a reader whose grant was revoked', async () => {
    const hub = await newHub();
    const grant = `acc_revoked_${home.readerUserId.slice(-8)}`;
    const docId = home.workspaceDoc;
    await db.update(schema.doc).set({ visibility: 'private' }).where(eq(schema.doc.id, docId));
    await db.insert(schema.docAccess).values({
      id: grant,
      organizationId: home.organizationId,
      docId,
      subjectType: 'user',
      subjectId: home.readerUserId,
    });
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`doc:${docId}`]);
      expect(hub.stats().subscriptions).toBe(1);

      await db.delete(schema.docAccess).where(eq(schema.docAccess.id, grant));

      await publishDelta(
        action({ model: 'doc', modelId: docId, scopes: [`doc:${docId}`], syncId: 11 }),
      );
      await waitFor(() => hub.stats().subscriptions === 0, 'the doc scope to be dropped');

      await publishDelta(
        action({ model: 'doc', modelId: docId, scopes: [`doc:${docId}`], syncId: 12 }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      const delivered = wired.socket
        .frames('delta')
        .flatMap((frame) => frame.actions.map((entry) => entry.syncId));
      expect(delivered).not.toContain(12);
    } finally {
      await db.update(schema.doc).set({ visibility: 'workspace' }).where(eq(schema.doc.id, docId));
      await hub.close();
    }
  });

  it('keeps the scope of a reader whose grant is still in place', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`doc:${home.docGrantedToReader}`]);

      await publishDelta(
        action({
          model: 'doc',
          modelId: home.docGrantedToReader,
          scopes: [`doc:${home.docGrantedToReader}`],
          syncId: 21,
        }),
      );
      await waitFor(() => wired.socket.frames('delta').length > 0, 'the first doc delta');
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await hub.close();
    }
  });
});

describe('membership and session revocation', () => {
  it('closes the connections of a removed member with the workspace forbidden code', async () => {
    const hub = await newHub();
    try {
      const removed = await connect(hub, home.strangerUserId, home.organizationId);
      const kept = await connect(hub, home.readerUserId, home.organizationId);

      await db.delete(schema.member).where(eq(schema.member.userId, home.strangerUserId));

      await publishDelta(
        action({
          model: 'member',
          action: 'delete',
          modelId: 'member_row',
          data: { userId: home.strangerUserId },
          scopes: [`org:${home.organizationId}`],
        }),
      );
      await waitFor(() => removed.socket.closures.length > 0, 'the removed member to be closed');

      expect(removed.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'membership_revoked',
      });
      expect(kept.socket.closures).toHaveLength(0);
    } finally {
      await db.insert(schema.member).values({
        id: `mem_restored_${home.strangerUserId.slice(-8)}`,
        organizationId: home.organizationId,
        userId: home.strangerUserId,
        role: 'member',
      });
      await hub.close();
    }
  });

  it('closes only the revoked session when a control message names its user', async () => {
    const hub = await newHub();
    try {
      const revoked = await connect(hub, home.readerUserId, home.organizationId);
      const other = await connect(hub, home.adminUserId, home.organizationId);
      await db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.session.id, revoked.sessionId));
      await db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.session.id, other.sessionId));

      await driver().publish(
        REDIS_CONTROL_CHANNEL,
        JSON.stringify({ type: 'session_revoked', userId: home.readerUserId }),
      );
      await waitFor(() => revoked.socket.closures.length > 0, 'the revoked session to be closed');
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(revoked.socket.closures[0]).toEqual({
        code: SESSION_REVOKED_CLOSE_CODE,
        reason: 'session_revoked',
      });
      expect(other.socket.closures).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('leaves a live session alone when the control message arrives', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);

      await driver().publish(
        REDIS_CONTROL_CHANNEL,
        JSON.stringify({ type: 'session_revoked', userId: home.readerUserId }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(wired.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
    } finally {
      await hub.close();
    }
  });

  it('closes only connections attached to a deleted workspace', async () => {
    const hub = await newHub();
    try {
      const deletedAdmin = await connect(hub, home.adminUserId, home.organizationId);
      const deletedReader = await connect(hub, home.readerUserId, home.organizationId);
      const retained = await connect(hub, away.adminUserId, away.organizationId);

      await driver().publish(
        REDIS_CONTROL_CHANNEL,
        JSON.stringify({
          type: 'organization_deleted',
          organizationId: home.organizationId,
        }),
      );
      await waitFor(
        () => deletedAdmin.socket.closures.length > 0 && deletedReader.socket.closures.length > 0,
        'the deleted workspace connections to be closed',
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(deletedAdmin.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'organization_deleted',
      });
      expect(deletedReader.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'organization_deleted',
      });
      expect(retained.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
    } finally {
      await hub.close();
    }
  });
});

describe('the periodic session sweep closes what no control message ever announced', () => {
  it('closes a connection whose session quietly expired and spares the rest', async () => {
    const hub = await newHub({ sessionSweepIntervalMs: 25 });
    try {
      const stale = await connect(hub, home.readerUserId, home.organizationId);
      const fresh = await connect(hub, home.adminUserId, home.organizationId);
      expect(hub.stats().connections).toBe(2);

      await db
        .update(schema.session)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.session.id, stale.sessionId));

      await waitFor(() => stale.socket.closures.length > 0, 'the expired session to be swept');

      expect(stale.socket.closures[0]).toEqual({
        code: SESSION_REVOKED_CLOSE_CODE,
        reason: 'session_revoked',
      });
      expect(fresh.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
    } finally {
      await hub.close();
    }
  });

  it('closes a connection whose session row was deleted outright', async () => {
    const hub = await newHub({ sessionSweepIntervalMs: 25 });
    try {
      const signedOut = await connect(hub, home.readerUserId, home.organizationId);

      await db.delete(schema.session).where(eq(schema.session.id, signedOut.sessionId));

      await waitFor(() => signedOut.socket.closures.length > 0, 'the deleted session to be swept');

      expect(signedOut.socket.closures[0]?.code).toBe(SESSION_REVOKED_CLOSE_CODE);
      expect(hub.stats().connections).toBe(0);
    } finally {
      await hub.close();
    }
  });

  it('leaves a connection whose session is still live alone across many sweeps', async () => {
    const hub = await newHub({ sessionSweepIntervalMs: 10 });
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(wired.socket.closures).toHaveLength(0);
      expect(hub.stats().connections).toBe(1);
      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await hub.close();
    }
  });
});

describe('a team membership delta re-checks what each connection can still reach', () => {
  it('drops the team scope of a member who was taken off the team', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);
      expect(hub.stats().subscriptions).toBe(1);

      const [row] = await db
        .select({ id: schema.teamMember.id })
        .from(schema.teamMember)
        .where(eq(schema.teamMember.userId, home.readerUserId))
        .limit(1);
      const membershipId = row?.id ?? '';
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, membershipId));

      await publishDelta(
        action({
          model: 'team_member',
          action: 'delete',
          modelId: membershipId,
          scopes: [`org:${home.organizationId}`],
        }),
      );
      await waitFor(() => hub.stats().subscriptions === 0, 'the team scope to be dropped');

      await db
        .insert(schema.teamMember)
        .values({ id: membershipId, teamId: home.teamCore, userId: home.readerUserId });
    } finally {
      await hub.close();
    }
  });
});
