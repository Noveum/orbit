import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';
import { and, db, eq, schema, sql } from '@orbit/db';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  REDIS_CONTROL_CHANNEL,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
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
const authModule = await import('../src/auth.ts');
const authorizeScopeActual = authModule.authorizeScope;
const authorizedIssueTeamIdActual = authModule.authorizedIssueTeamId;

type AuthorizationKind = 'scope' | 'issue';

interface AuthorizationPause {
  readonly kind: AuthorizationKind;
  readonly key: string;
  readonly started: Promise<void>;
  readonly release: () => void;
}

interface ActiveAuthorizationPause {
  readonly kind: AuthorizationKind;
  readonly key: string;
  readonly started: () => void;
  readonly released: Promise<void>;
}

const authorizationPauses: ActiveAuthorizationPause[] = [];

function holdAuthorization(kind: AuthorizationKind, key: string): AuthorizationPause {
  let markStarted: () => void = () => undefined;
  let releaseWaiter: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseWaiter = resolve;
  });
  const active = { kind, key, started: markStarted, released };
  authorizationPauses.push(active);
  return {
    kind,
    key,
    started,
    release: () => {
      const index = authorizationPauses.indexOf(active);
      if (index >= 0) authorizationPauses.splice(index, 1);
      releaseWaiter();
    },
  };
}

async function waitAfterAuthorization(kind: AuthorizationKind, key: string): Promise<void> {
  const pause = authorizationPauses.find((entry) => entry.kind === kind && entry.key === key);
  if (pause === undefined) return;
  pause.started();
  await pause.released;
}

mock.module('../src/logger.ts', () => ({
  ...loggerModule,
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
mock.module('../src/auth.ts', () => ({
  ...authModule,
  authorizeScope: async (...args: Parameters<typeof authModule.authorizeScope>) => {
    const allowed = await authorizeScopeActual(...args);
    await waitAfterAuthorization('scope', args[0]);
    return allowed;
  },
  authorizedIssueTeamId: async (...args: Parameters<typeof authModule.authorizedIssueTeamId>) => {
    const teamId = await authorizedIssueTeamIdActual(...args);
    await waitAfterAuthorization('issue', args[0]);
    return teamId;
  },
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
  mock.module('../src/auth.ts', () => authModule);
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
    data: { id: 'issue_1', teamId: home.teamCore },
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

async function publishDeltas(entries: readonly SyncAction[]): Promise<void> {
  await driver().publish(REDIS_DELTA_CHANNEL, JSON.stringify(entries));
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

  it('blocks a foreign-team issue with a matching organization and forged team scope', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`org:${home.organizationId}`]);

      await publishDelta(
        action({
          modelId: home.issueOnOther,
          scopes: [`org:${home.organizationId}`, `team:${home.teamCore}`],
          data: {
            id: home.issueOnOther,
            teamId: home.teamOther,
            title: 'Other team secret',
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(wired.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('fails closed when an issue-bound action omits its team scope', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`issue:${home.issueOnCore}`]);

      await publishDelta(
        action({
          model: 'attachment',
          modelId: 'attachment_without_team',
          scopes: [`issue:${home.issueOnCore}`],
          data: { id: 'attachment_without_team', parentId: home.issueOnCore },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(wired.socket.frames('delta')).toHaveLength(0);
    } finally {
      await hub.close();
    }
  });

  it('delivers an issue tombstone after its database row is gone', async () => {
    const hub = await newHub();
    const deletedIssueId = 'issue_already_deleted';
    const issueScope = `issue:${deletedIssueId}`;
    try {
      const [template] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, home.issueOnCore))
        .limit(1);
      if (template === undefined) throw new Error('missing issue template');
      await db.insert(schema.issue).values({
        ...template,
        id: deletedIssueId,
        number: 999_992,
        identifier: 'CORE-999992',
      });
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      const admin = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`, issueScope]);
      await subscribe(admin, [issueScope]);
      wired.session.message(
        JSON.stringify({ type: 'presence', scope: issueScope, kind: 'viewing' }),
      );
      await waitFor(
        () => admin.socket.frames('presence').length > 0,
        'the issue presence before deletion',
      );
      const stalePresence = admin.socket.last('presence')?.messages[0];
      if (stalePresence === undefined) throw new Error('missing issue presence');
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));

      await publishDelta(
        action({
          action: 'delete',
          modelId: deletedIssueId,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: deletedIssueId,
            teamId: home.teamCore,
            identifier: 'CORE-404',
          },
          syncId: 24,
        }),
      );
      await waitFor(() => wired.socket.frames('delta').length > 0, 'the issue tombstone');
      await waitFor(() => hub.stats().subscriptions === 1, 'the deleted issue scope cleanup');
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({ ...stalePresence, audience: { teamId: home.teamCore } }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wired.socket.last('delta')?.actions[0]?.modelId).toBe(deletedIssueId);
      expect(admin.socket.frames('presence')).toHaveLength(1);
    } finally {
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));
      await hub.close();
    }
  });

  it('delivers a newer hard delete despite an older cached team boundary', async () => {
    const hub = await newHub();
    const deletedIssueId = 'issue_deleted_after_move';
    const issueScope = `issue:${deletedIssueId}`;
    const destinationMembershipId = `tm_delete_${home.strangerUserId.slice(-8)}`;
    try {
      const [template] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, home.issueOnCore))
        .limit(1);
      if (template === undefined) throw new Error('missing issue template');
      await db.insert(schema.issue).values({
        ...template,
        id: deletedIssueId,
        number: 999_986,
        identifier: 'CORE-999986',
        syncId: 170,
      });
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      await publishDelta(
        action({
          modelId: deletedIssueId,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: deletedIssueId,
            teamId: home.teamCore,
            teamChanged: true,
          },
          syncId: 170,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_985, syncId: 180 })
        .where(eq(schema.issue.id, deletedIssueId));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));

      await publishDelta(
        action({
          action: 'delete',
          modelId: deletedIssueId,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: deletedIssueId,
            teamId: home.teamOther,
            identifier: 'OTHER-999985',
          },
          syncId: 180,
        }),
      );
      await waitFor(() => destination.socket.frames('delta').length > 0, 'the moved hard delete');

      expect(destination.socket.last('delta')?.actions[0]?.modelId).toBe(deletedIssueId);
      expect(hub.stats().subscriptions).toBe(0);
    } finally {
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
      await hub.close();
    }
  });

  it('rejects a hard delete while its authoritative issue row is still live', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [issueScope]);

      await publishDelta(
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-LIVE',
          },
          syncId: 200,
        }),
      );
      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_forged_delete',
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: 'comment_after_forged_delete',
            issueId: home.issueOnCore,
            body: 'Still live after forged delete',
          },
          syncId: 201,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      const delivered = JSON.stringify(wired.socket.frames('delta'));
      expect(delivered).not.toContain('CORE-LIVE');
      expect(delivered).toContain('Still live after forged delete');
      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await hub.close();
    }
  });

  it('retries an in-flight issue subscription across a hard delete', async () => {
    const hub = await newHub();
    const deletedIssueId = 'issue_deleted_during_subscribe';
    const issueScope = `issue:${deletedIssueId}`;
    const pause = holdAuthorization('scope', issueScope);
    try {
      const [template] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, home.issueOnCore))
        .limit(1);
      if (template === undefined) throw new Error('missing issue template');
      await db.insert(schema.issue).values({
        ...template,
        id: deletedIssueId,
        number: 999_984,
        identifier: 'CORE-999984',
        syncId: 190,
      });
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      wired.session.message(JSON.stringify({ type: 'subscribe', scopes: [issueScope] }));
      await pause.started;
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));

      await publishDelta(
        action({
          action: 'delete',
          modelId: deletedIssueId,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: deletedIssueId,
            teamId: home.teamCore,
            identifier: 'CORE-999984',
          },
          syncId: 190,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      pause.release();
      await waitFor(
        () => wired.socket.frames('subscribed').length > 0,
        'the retried deleted issue subscription',
      );

      expect(wired.socket.last('subscribed')?.scopes).not.toContain(issueScope);
      expect(wired.socket.last('subscribed')?.denied).toContain(issueScope);
      expect(hub.stats().subscriptions).toBe(0);
    } finally {
      pause.release();
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));
      await hub.close();
    }
  });

  it('drops a retained issue scope before a cross-team arrival can disclose the new row', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    const projectScope = `project:${home.projectWithoutTeams}`;
    const destinationMembershipId = `tm_move_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      const oldTeam = await connect(hub, home.readerUserId, home.organizationId);
      const admin = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(oldTeam, [`team:${home.teamCore}`, issueScope, projectScope]);
      await subscribe(admin, [issueScope]);
      oldTeam.session.message(
        JSON.stringify({ type: 'presence', scope: issueScope, kind: 'viewing' }),
      );
      await waitFor(
        () => admin.socket.frames('presence').length > 0,
        'the source presence before the move',
      );
      const stalePresence = admin.socket.last('presence')?.messages[0];
      if (stalePresence === undefined) throw new Error('missing source presence');
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_999, syncId: 30 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(destination.socket.frames('presence')).toHaveLength(0);
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          ...stalePresence,
          audience: { teamId: home.teamCore },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(destination.socket.frames('presence')).toHaveLength(0);

      await publishDeltas([
        action({
          model: 'comment',
          modelId: 'comment_overtook_move',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_overtook_move',
            issueId: home.issueOnCore,
            body: 'Destination comment before move delta',
          },
          syncId: 29,
        }),
        action({
          model: 'attachment',
          modelId: 'attachment_overtook_move',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'attachment_overtook_move',
            parentType: 'issue',
            parentId: home.issueOnCore,
            fileName: 'destination-secret.txt',
          },
          syncId: 29,
        }),
      ]);
      await waitFor(
        () => admin.socket.frames('delta').flatMap((frame) => frame.actions).length === 2,
        'the destination payloads that overtook the move',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(oldTeam.socket.frames('delta')).toHaveLength(0);

      await publishDeltas([
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope, projectScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-1',
            departure: true,
            syncId: 30,
          },
          syncId: 30,
        }),
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope, projectScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            identifier: 'OTHER-1',
            title: 'Destination secret',
            teamChanged: true,
            syncId: 30,
          },
          syncId: 30,
        }),
      ]);
      await waitFor(() => oldTeam.socket.frames('delta').length > 0, 'the departure delta');
      await waitFor(() => admin.socket.frames('delta').length > 0, 'the admin move delta');

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope, projectScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            identifier: 'OTHER-1',
            title: 'Later destination secret',
            syncId: 31,
          },
          syncId: 31,
        }),
      );
      await waitFor(
        () =>
          admin.socket
            .frames('delta')
            .flatMap((frame) => frame.actions)
            .filter((entry) => entry.model === 'issue').length === 3,
        'the ordinary destination update',
      );
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          ...stalePresence,
          audience: { teamId: home.teamCore },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      const oldActions = oldTeam.socket.frames('delta').flatMap((frame) => frame.actions);
      const adminActions = admin.socket.frames('delta').flatMap((frame) => frame.actions);
      const adminIssueActions = adminActions.filter((entry) => entry.model === 'issue');
      expect(oldActions.map((entry) => entry.action)).toEqual(['delete']);
      expect(JSON.stringify(oldActions)).not.toContain('Destination secret');
      expect(JSON.stringify(oldActions)).not.toContain('Later destination secret');
      expect(adminIssueActions.map((entry) => entry.action)).toEqual([
        'delete',
        'update',
        'update',
      ]);
      expect(hub.stats().subscriptions).toBe(4);

      oldTeam.session.message(
        JSON.stringify({ type: 'presence', scope: issueScope, kind: 'viewing' }),
      );
      await waitFor(
        () => oldTeam.socket.frames('error').length > 0,
        'the departed issue scope to reject presence',
      );
      expect(oldTeam.socket.last('error')?.code).toBe('forbidden_scope');

      expect(destination.socket.frames('presence')).toHaveLength(0);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
      await hub.close();
    }
  });

  it('revokes an issue scope before any split move payload can reuse it', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(source, [issueScope]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_998, syncId: 44 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-1',
            departure: true,
            syncId: 44,
          },
          syncId: 44,
        }),
      );
      await waitFor(() => source.socket.frames('delta').length > 0, 'the split departure');
      await waitFor(() => hub.stats().subscriptions === 0, 'the split issue scope revocation');

      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_secret',
          scopes: [issueScope],
          data: { id: 'comment_secret', issueId: home.issueOnCore, body: 'Destination comment' },
          syncId: 45,
        }),
      );
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          organizationId: home.organizationId,
          scope: issueScope,
          kind: 'viewing',
          userId: home.adminUserId,
          name: 'Ada Admin',
          image: null,
          at: new Date().toISOString(),
          audience: { teamId: home.teamOther },
        }),
      );

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            identifier: 'OTHER-1',
            title: 'Still allowed',
            teamChanged: true,
            syncId: 44,
          },
          syncId: 44,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const received = source.socket.frames('delta').flatMap((frame) => frame.actions);
      expect(received.map((entry) => entry.action)).toEqual(['delete']);
      expect(JSON.stringify(received)).not.toContain('Destination comment');
      expect(JSON.stringify(received)).not.toContain('Still allowed');
      expect(source.socket.frames('presence')).toHaveLength(0);
      expect(hub.stats().subscriptions).toBe(0);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await hub.close();
    }
  });

  it('keeps the destination boundary when a split move departure arrives late', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    const destinationMembershipId = `tm_late_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_997, syncId: 54 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            identifier: 'OTHER-1',
            title: 'Destination arrival',
            teamChanged: true,
          },
          syncId: 54,
        }),
      );
      await publishDelta(
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-1',
            departure: true,
          },
          syncId: 54,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(hub.stats().subscriptions).toBe(1);

      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_late_departure',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_late_departure',
            issueId: home.issueOnCore,
            body: 'Still in destination',
          },
          syncId: 55,
        }),
      );
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          organizationId: home.organizationId,
          scope: issueScope,
          kind: 'viewing',
          userId: home.adminUserId,
          name: 'Ada Admin',
          image: null,
          at: new Date().toISOString(),
          audience: { teamId: home.teamOther },
        }),
      );
      await waitFor(
        () =>
          destination.socket
            .frames('delta')
            .flatMap((frame) => frame.actions)
            .some((entry) => entry.modelId === 'comment_after_late_departure'),
        'the destination delta after the late departure',
      );
      await waitFor(
        () => destination.socket.frames('presence').length > 0,
        'the destination presence after the late departure',
      );
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
      await hub.close();
    }
  });

  it('rejects delayed source-team metadata after an issue crosses the team boundary', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(source, [`team:${home.teamCore}`]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_996, syncId: 64 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            identifier: 'OTHER-2',
            title: 'Destination issue',
            teamChanged: true,
          },
          syncId: 64,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      await publishDeltas([
        action({
          model: 'comment',
          modelId: 'comment_delayed_from_source',
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: 'comment_delayed_from_source',
            issueId: home.issueOnCore,
            body: 'Delayed source comment',
          },
          syncId: 63,
        }),
        action({
          model: 'attachment',
          modelId: 'attachment_delayed_from_source',
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: 'attachment_delayed_from_source',
            parentType: 'issue',
            parentId: home.issueOnCore,
            fileName: 'delayed-source.txt',
          },
          syncId: 63,
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(source.socket.frames('delta')).toHaveLength(0);
      expect(source.socket.last('subscribed')?.scopes).toContain(`team:${home.teamCore}`);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await hub.close();
    }
  });

  it('falls back to authoritative reach after a move boundary is evicted', async () => {
    const hub = await newHub({ maxIssueTeamBoundaries: 1 });
    const issueScope = `issue:${home.issueOnCore}`;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(source, [`team:${home.teamCore}`]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_994, syncId: 84 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            teamChanged: true,
          },
          syncId: 84,
        }),
      );
      await db
        .update(schema.issue)
        .set({ syncId: 85 })
        .where(eq(schema.issue.id, home.issueOnOther));
      await publishDelta(
        action({
          modelId: home.issueOnOther,
          scopes: [`team:${home.teamOther}`, `issue:${home.issueOnOther}`],
          data: {
            id: home.issueOnOther,
            teamId: home.teamOther,
            teamChanged: true,
          },
          syncId: 85,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      await publishDelta(
        action({
          model: 'attachment',
          modelId: 'attachment_after_boundary_eviction',
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: 'attachment_after_boundary_eviction',
            parentType: 'issue',
            parentId: home.issueOnCore,
            fileName: 'evicted-source.txt',
          },
          syncId: 83,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(JSON.stringify(source.socket.frames('delta'))).not.toContain('evicted-source.txt');
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db
        .update(schema.issue)
        .set({ syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnOther));
      await hub.close();
    }
  });

  it('rejects a stale move arrival after its cached boundary expires', async () => {
    const hub = await newHub({ issueTeamBoundaryTtlMs: 5 });
    const issueScope = `issue:${home.issueOnCore}`;
    const destinationMembershipId = `tm_expire_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      const source = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(source, [issueScope]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_993, syncId: 94 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            teamChanged: true,
          },
          syncId: 94,
        }),
      );
      await waitFor(() => hub.stats().subscriptions === 1, 'the source scope removal');
      await new Promise((resolve) => setTimeout(resolve, 10));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            title: 'Stale source arrival',
            teamChanged: true,
          },
          syncId: 93,
        }),
      );
      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_expired_boundary',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_expired_boundary',
            issueId: home.issueOnCore,
            body: 'Current destination comment',
          },
          syncId: 95,
        }),
      );
      await waitFor(
        () =>
          destination.socket
            .frames('delta')
            .flatMap((frame) => frame.actions)
            .some((entry) => entry.modelId === 'comment_after_expired_boundary'),
        'the destination delta after a stale expired arrival',
      );

      expect(hub.stats().subscriptions).toBe(1);
      expect(JSON.stringify(source.socket.frames('delta'))).not.toContain('Stale source arrival');
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
      await hub.close();
    }
  });

  it('rejects a cache-cold stale move whose old destination is current again', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    const destinationMembershipId = `tm_return_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_989, syncId: 130 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            title: 'Obsolete same-team arrival',
            teamChanged: true,
          },
          syncId: 120,
        }),
      );
      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_same_team_replay',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_same_team_replay',
            issueId: home.issueOnCore,
            body: 'Current destination metadata',
          },
          syncId: 131,
        }),
      );
      await waitFor(
        () =>
          destination.socket
            .frames('delta')
            .flatMap((frame) => frame.actions)
            .some((entry) => entry.modelId === 'comment_after_same_team_replay'),
        'the current metadata after a same-team replay',
      );

      expect(JSON.stringify(destination.socket.frames('delta'))).not.toContain(
        'Obsolete same-team arrival',
      );
      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
      await hub.close();
    }
  });

  it('rejects a cache-cold future move that could poison the current boundary', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    const destinationMembershipId = `tm_future_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_988, syncId: 130 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            title: 'Forged future arrival',
            teamChanged: true,
          },
          syncId: 140,
        }),
      );
      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_future_replay',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_future_replay',
            issueId: home.issueOnCore,
            body: 'Authoritative current metadata',
          },
          syncId: 131,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      const delivered = JSON.stringify(destination.socket.frames('delta'));
      expect(delivered).not.toContain('Forged future arrival');
      expect(delivered).toContain('Authoritative current metadata');
      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
      await hub.close();
    }
  });

  it('rejects a cache-cold stale departure after the issue returned to its source', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    const currentMembershipId = `tm_departure_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: currentMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_987, syncId: 160 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const currentReader = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(currentReader, [issueScope]);

      await publishDeltas([
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            identifier: 'OLD-150',
            departure: true,
          },
          syncId: 150,
        }),
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            title: 'Stale return departure destination',
            teamChanged: true,
          },
          syncId: 150,
        }),
      ]);
      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_stale_departure',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_stale_departure',
            issueId: home.issueOnCore,
            body: 'Current metadata after stale departure',
          },
          syncId: 161,
        }),
      );
      await waitFor(
        () =>
          JSON.stringify(currentReader.socket.frames('delta')).includes(
            'Current metadata after stale departure',
          ),
        'the current metadata after the stale departure',
      );

      const delivered = JSON.stringify(currentReader.socket.frames('delta'));
      expect(delivered).not.toContain('OLD-150');
      expect(delivered).not.toContain('Stale return departure destination');
      expect(delivered).toContain('Current metadata after stale departure');
      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, currentMembershipId));
      await hub.close();
    }
  });

  it('delivers a cache-cold delayed departure after the destination issue advanced', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      const destination = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(source, [`team:${home.teamCore}`, issueScope]);
      await subscribe(destination, [`team:${home.teamOther}`]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_983, syncId: 160 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-DELAYED-150',
            departure: true,
          },
          syncId: 150,
        }),
      );
      await waitFor(
        () => JSON.stringify(source.socket.frames('delta')).includes('CORE-DELAYED-150'),
        'the delayed source departure',
      );

      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_delayed_departure',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_delayed_departure',
            issueId: home.issueOnCore,
            body: 'Current destination after delayed departure',
          },
          syncId: 161,
        }),
      );
      await waitFor(
        () =>
          JSON.stringify(destination.socket.frames('delta')).includes(
            'Current destination after delayed departure',
          ),
        'the current destination metadata',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(JSON.stringify(source.socket.frames('delta'))).not.toContain(
        'Current destination after delayed departure',
      );
      expect(hub.stats().subscriptions).toBe(2);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await hub.close();
    }
  });

  it('delivers an accepted delayed departure across a newer cached boundary', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      const destination = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(source, [`team:${home.teamCore}`, issueScope]);
      await subscribe(destination, [`team:${home.teamOther}`]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_982, syncId: 180 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            title: 'Newer cached destination',
            teamChanged: true,
          },
          syncId: 180,
        }),
      );
      await waitFor(
        () =>
          JSON.stringify(destination.socket.frames('delta')).includes('Newer cached destination'),
        'the newer cached destination arrival',
      );
      await db
        .update(schema.issue)
        .set({ title: 'Advanced destination row', syncId: 190 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-CACHED-170',
            departure: true,
          },
          syncId: 170,
        }),
      );
      await waitFor(
        () => JSON.stringify(source.socket.frames('delta')).includes('CORE-CACHED-170'),
        'the departure behind a newer boundary',
      );

      expect(hub.stats().subscriptions).toBe(2);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, title: 'On the core team', syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await hub.close();
    }
  });

  it('uses a delayed departure as a safe tombstone after a later hard delete', async () => {
    const hub = await newHub();
    const deletedIssueId = 'issue_deleted_after_delayed_departure';
    const issueScope = `issue:${deletedIssueId}`;
    try {
      const [template] = await db
        .select()
        .from(schema.issue)
        .where(eq(schema.issue.id, home.issueOnCore))
        .limit(1);
      if (template === undefined) throw new Error('missing issue template');
      await db.insert(schema.issue).values({
        ...template,
        id: deletedIssueId,
        number: 999_981,
        identifier: 'CORE-999981',
        syncId: 200,
      });
      const source = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(source, [`team:${home.teamCore}`, issueScope]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_980, syncId: 210 })
        .where(eq(schema.issue.id, deletedIssueId));
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));

      await publishDelta(
        action({
          action: 'delete',
          modelId: deletedIssueId,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: deletedIssueId,
            teamId: home.teamCore,
            identifier: 'CORE-DELETED-200',
            departure: true,
          },
          syncId: 200,
        }),
      );
      await waitFor(
        () => JSON.stringify(source.socket.frames('delta')).includes('CORE-DELETED-200'),
        'the delayed departure after hard deletion',
      );

      expect(hub.stats().subscriptions).toBe(1);
    } finally {
      await db.delete(schema.issue).where(eq(schema.issue.id, deletedIssueId));
      await hub.close();
    }
  });

  it('retries an in-flight source subscription across an issue move', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    let subscriptionPause: AuthorizationPause | null = null;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      subscriptionPause = holdAuthorization('scope', issueScope);

      source.session.message(JSON.stringify({ type: 'subscribe', scopes: [issueScope] }));
      await subscriptionPause.started;
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_991, syncId: 104 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            teamChanged: true,
          },
          syncId: 104,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      subscriptionPause.release();
      await waitFor(
        () => source.socket.frames('subscribed').length > 0,
        'the retried issue subscription',
      );

      expect(source.socket.last('subscribed')?.scopes).not.toContain(issueScope);
      expect(source.socket.last('subscribed')?.denied).toContain(issueScope);
    } finally {
      subscriptionPause?.release();
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await hub.close();
    }
  });

  it('retries in-flight source presence across an issue move', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    let pause: AuthorizationPause | null = null;
    try {
      const source = await connect(hub, home.readerUserId, home.organizationId);
      const admin = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(admin, [issueScope]);
      pause = holdAuthorization('issue', home.issueOnCore);
      source.session.message(
        JSON.stringify({ type: 'presence', scope: issueScope, kind: 'viewing' }),
      );
      await pause.started;
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_990, syncId: 105 })
        .where(eq(schema.issue.id, home.issueOnCore));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamOther,
            teamChanged: true,
          },
          syncId: 105,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      pause.release();
      await waitFor(
        () => source.socket.frames('error').length > 0,
        'the retried issue presence rejection',
      );

      expect(source.socket.last('error')?.code).toBe('forbidden_scope');
      expect(admin.socket.frames('presence')).toHaveLength(0);
    } finally {
      pause?.release();
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await hub.close();
    }
  });

  it('retains a destination reader when a split departure arrives before its arrival', async () => {
    const hub = await newHub();
    const issueScope = `issue:${home.issueOnCore}`;
    const destinationMembershipId = `tm_depart_${home.strangerUserId.slice(-8)}`;
    try {
      await db.insert(schema.teamMember).values({
        id: destinationMembershipId,
        teamId: home.teamOther,
        userId: home.strangerUserId,
      });
      const source = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(source, [issueScope]);
      await db
        .update(schema.issue)
        .set({ teamId: home.teamOther, number: 999_995, syncId: 74 })
        .where(eq(schema.issue.id, home.issueOnCore));
      const destination = await connect(hub, home.strangerUserId, home.organizationId);
      await subscribe(destination, [issueScope]);

      await publishDelta(
        action({
          action: 'delete',
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`, issueScope],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            identifier: 'CORE-1',
            departure: true,
          },
          syncId: 74,
        }),
      );
      await waitFor(
        () => source.socket.frames('delta').flatMap((frame) => frame.actions).length > 0,
        'the source departure',
      );

      await publishDelta(
        action({
          model: 'comment',
          modelId: 'comment_after_departure_first',
          scopes: [`team:${home.teamOther}`, issueScope],
          data: {
            id: 'comment_after_departure_first',
            issueId: home.issueOnCore,
            body: 'Destination comment',
          },
          syncId: 75,
        }),
      );
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          organizationId: home.organizationId,
          scope: issueScope,
          kind: 'viewing',
          userId: home.adminUserId,
          name: 'Ada Admin',
          image: null,
          at: new Date().toISOString(),
          audience: { teamId: home.teamOther },
        }),
      );
      await waitFor(
        () =>
          destination.socket
            .frames('delta')
            .flatMap((frame) => frame.actions)
            .some((entry) => entry.modelId === 'comment_after_departure_first'),
        'the destination delta after a departure-first move',
      );
      await waitFor(
        () => destination.socket.frames('presence').length > 0,
        'the destination presence after a departure-first move',
      );

      source.session.message(
        JSON.stringify({ type: 'presence', scope: issueScope, kind: 'viewing' }),
      );
      await waitFor(
        () => source.socket.frames('error').length > 0,
        'the source issue scope revocation',
      );
      expect(source.socket.last('error')?.code).toBe('forbidden_scope');
      expect(destination.socket.last('subscribed')?.scopes).toContain(issueScope);
    } finally {
      await db
        .update(schema.issue)
        .set({ teamId: home.teamCore, number: 1, syncId: 0 })
        .where(eq(schema.issue.id, home.issueOnCore));
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, destinationMembershipId));
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
  it('delivers a doc tombstone after removing its held scope', async () => {
    const hub = await newHub();
    const deletedDocId = 'doc_already_deleted';
    const docScope = `doc:${deletedDocId}`;
    await db.insert(schema.doc).values({
      id: deletedDocId,
      organizationId: home.organizationId,
      title: 'Deleted doc',
      authorId: home.adminUserId,
      visibility: 'workspace',
    });
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [docScope]);
      await db.delete(schema.doc).where(eq(schema.doc.id, deletedDocId));

      await publishDelta(
        action({
          action: 'delete',
          model: 'doc',
          modelId: deletedDocId,
          scopes: [docScope],
          data: { id: deletedDocId },
          syncId: 14,
        }),
      );
      await waitFor(() => hub.stats().subscriptions === 0, 'the deleted doc scope cleanup');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wired.socket.last('delta')?.actions[0]?.modelId).toBe(deletedDocId);
    } finally {
      await db.delete(schema.doc).where(eq(schema.doc.id, deletedDocId));
      await hub.close();
    }
  });

  it('retries an in-flight doc subscription after access changes', async () => {
    const hub = await newHub();
    const grant = `acc_subscribe_${home.readerUserId.slice(-8)}`;
    const docId = home.workspaceDoc;
    const docScope = `doc:${docId}`;
    const pause = holdAuthorization('scope', docScope);
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
      wired.session.message(JSON.stringify({ type: 'subscribe', scopes: [docScope] }));
      await pause.started;
      await db.delete(schema.docAccess).where(eq(schema.docAccess.id, grant));

      await publishDelta(action({ model: 'doc', modelId: docId, scopes: [docScope], syncId: 13 }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      pause.release();
      await waitFor(
        () => wired.socket.frames('subscribed').length > 0,
        'the retried doc subscription',
      );

      expect(wired.socket.last('subscribed')?.scopes).not.toContain(docScope);
      expect(wired.socket.last('subscribed')?.denied).toContain(docScope);
    } finally {
      pause.release();
      await db.update(schema.doc).set({ visibility: 'workspace' }).where(eq(schema.doc.id, docId));
      await db.delete(schema.docAccess).where(eq(schema.docAccess.id, grant));
      await hub.close();
    }
  });

  it('rejects in-flight doc presence after access changes', async () => {
    const hub = await newHub();
    const grant = `acc_presence_${home.readerUserId.slice(-8)}`;
    const docId = home.workspaceDoc;
    const docScope = `doc:${docId}`;
    await db.update(schema.doc).set({ visibility: 'private' }).where(eq(schema.doc.id, docId));
    await db.insert(schema.docAccess).values({
      id: grant,
      organizationId: home.organizationId,
      docId,
      subjectType: 'user',
      subjectId: home.readerUserId,
    });
    let pause: AuthorizationPause | null = null;
    try {
      const author = await connect(hub, home.readerUserId, home.organizationId);
      const watcher = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(watcher, [docScope]);
      pause = holdAuthorization('scope', docScope);
      author.session.message(
        JSON.stringify({ type: 'presence', scope: docScope, kind: 'viewing' }),
      );
      await pause.started;
      await db.delete(schema.docAccess).where(eq(schema.docAccess.id, grant));

      await publishDelta(action({ model: 'doc', modelId: docId, scopes: [docScope], syncId: 14 }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      pause.release();
      await waitFor(
        () => author.socket.frames('error').length > 0,
        'the retried doc presence rejection',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(author.socket.last('error')?.code).toBe('forbidden_scope');
      expect(watcher.socket.frames('presence')).toHaveLength(0);
    } finally {
      pause?.release();
      await db.update(schema.doc).set({ visibility: 'workspace' }).where(eq(schema.doc.id, docId));
      await db.delete(schema.docAccess).where(eq(schema.docAccess.id, grant));
      await hub.close();
    }
  });

  it('filters the revocation delta and later doc payloads before they can flush', async () => {
    const hub = await newHub({ batchWindowMs: 1 });
    const grant = `acc_fenced_${home.readerUserId.slice(-8)}`;
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
      await db.delete(schema.docAccess).where(eq(schema.docAccess.id, grant));

      await publishDeltas([
        action({
          model: 'doc',
          modelId: docId,
          scopes: [`doc:${docId}`],
          data: { id: docId, title: 'Revoked doc title' },
          syncId: 15,
        }),
        action({
          model: 'doc_comment',
          modelId: 'doc_comment_after_revoke',
          scopes: [`doc:${docId}`],
          data: { id: 'doc_comment_after_revoke', body: 'Revoked doc comment' },
          syncId: 16,
        }),
      ]);
      await waitFor(() => hub.stats().subscriptions === 0, 'the fenced doc revocation');
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain('Revoked doc title');
      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain('Revoked doc comment');
    } finally {
      await db.update(schema.doc).set({ visibility: 'workspace' }).where(eq(schema.doc.id, docId));
      await hub.close();
    }
  });

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

describe('a project-scoped delta re-authorizes readers after team links change', () => {
  it('drops retained project reach before later attachment metadata can flush', async () => {
    const hub = await newHub({ batchWindowMs: 1 });
    const linkId = `pt_fenced_${home.readerUserId.slice(-8)}`;
    const projectScope = `project:${home.projectWithoutTeams}`;
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [projectScope]);
      await db.insert(schema.projectTeam).values({
        id: linkId,
        projectId: home.projectWithoutTeams,
        teamId: home.teamOther,
      });

      await publishDeltas([
        action({
          model: 'project',
          modelId: home.projectWithoutTeams,
          scopes: [projectScope, `team:${home.teamOther}`],
          data: {
            projectId: home.projectWithoutTeams,
            teamId: home.teamOther,
          },
          syncId: 25,
        }),
        action({
          model: 'attachment',
          modelId: 'project_attachment_after_restrict',
          scopes: [projectScope],
          data: {
            id: 'project_attachment_after_restrict',
            parentType: 'project',
            parentId: home.projectWithoutTeams,
            fileName: 'restricted-project.txt',
          },
          syncId: 26,
        }),
      ]);
      await waitFor(() => hub.stats().subscriptions === 0, 'the project scope revocation');
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain('restricted-project.txt');
    } finally {
      await db.delete(schema.projectTeam).where(eq(schema.projectTeam.id, linkId));
      await hub.close();
    }
  });
});

describe('membership and session revocation', () => {
  it('closes affected connections when a member removal cannot be revalidated', async () => {
    const hub = await newHub();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);

      await publishDeltas([
        action({
          model: 'member',
          action: 'delete',
          modelId: 'malformed_member_row',
          data: {},
          scopes: [`org:${home.organizationId}`],
          syncId: 60,
        }),
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            title: 'Restricted after malformed removal',
          },
          syncId: 61,
        }),
      ]);
      await waitFor(
        () => wired.socket.closures.length > 0,
        'the malformed removal connection closure',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wired.socket.closures[0]).toEqual({
        code: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
        reason: 'membership_revoked',
      });
      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain(
        'Restricted after malformed removal',
      );
    } finally {
      await hub.close();
    }
  });

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
  async function coreMembershipId(): Promise<string> {
    const [row] = await db
      .select({ id: schema.teamMember.id })
      .from(schema.teamMember)
      .where(
        and(
          eq(schema.teamMember.teamId, home.teamCore),
          eq(schema.teamMember.userId, home.readerUserId),
        ),
      )
      .limit(1);
    if (row === undefined) throw new Error('missing core team membership');
    return row.id;
  }

  async function restoreCoreMembership(id: string): Promise<void> {
    await db
      .insert(schema.teamMember)
      .values({ id, teamId: home.teamCore, userId: home.readerUserId })
      .onConflictDoNothing();
  }

  it('holds subscribe and presence until membership reach is refreshed', async () => {
    const hub = await newHub();
    const membershipId = await coreMembershipId();
    try {
      const removed = await connect(hub, home.readerUserId, home.organizationId);
      const watcher = await connect(hub, home.adminUserId, home.organizationId);
      await subscribe(watcher, [`team:${home.teamCore}`]);

      await db.transaction(async (tx) => {
        await tx.execute(sql`lock table ${schema.teamMember} in access exclusive mode`);
        await tx.delete(schema.teamMember).where(eq(schema.teamMember.id, membershipId));
        await publishDelta(
          action({
            model: 'team_member',
            action: 'delete',
            modelId: membershipId,
            scopes: [`org:${home.organizationId}`],
            syncId: 65,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));

        removed.session.message(
          JSON.stringify({ type: 'subscribe', scopes: [`team:${home.teamCore}`] }),
        );
        removed.session.message(
          JSON.stringify({
            type: 'presence',
            scope: `team:${home.teamCore}`,
            kind: 'viewing',
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      await waitFor(
        () => removed.socket.frames('subscribed').length > 0,
        'the post-refresh subscribe result',
      );
      await waitFor(
        () => removed.socket.frames('error').length > 0,
        'the post-refresh presence rejection',
      );
      await new Promise((resolve) => setTimeout(resolve, 40));

      expect(removed.socket.last('subscribed')?.scopes).not.toContain(`team:${home.teamCore}`);
      expect(removed.socket.last('subscribed')?.denied).toContain(`team:${home.teamCore}`);
      expect(removed.socket.last('error')?.code).toBe('forbidden_scope');
      expect(watcher.socket.frames('presence')).toHaveLength(0);
    } finally {
      await restoreCoreMembership(membershipId);
      await hub.close();
    }
  });

  it('blocks restricted data later in the membership removal envelope', async () => {
    const hub = await newHub({ batchWindowMs: 1 });
    const membershipId = await coreMembershipId();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, membershipId));

      await publishDeltas([
        action({
          model: 'team_member',
          action: 'delete',
          modelId: membershipId,
          scopes: [`org:${home.organizationId}`],
          syncId: 70,
        }),
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            title: 'Restricted after same-envelope removal',
          },
          syncId: 71,
        }),
      ]);
      await waitFor(() => hub.stats().subscriptions === 0, 'the same-envelope reach revocation');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain(
        'Restricted after same-envelope removal',
      );
    } finally {
      await restoreCoreMembership(membershipId);
      await hub.close();
    }
  });

  it('blocks restricted data in the next membership removal envelope', async () => {
    const hub = await newHub({ batchWindowMs: 1 });
    const membershipId = await coreMembershipId();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, membershipId));

      await publishDelta(
        action({
          model: 'team_member',
          action: 'delete',
          modelId: membershipId,
          scopes: [`org:${home.organizationId}`],
          syncId: 80,
        }),
      );
      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            title: 'Restricted after next-envelope removal',
          },
          syncId: 81,
        }),
      );
      await waitFor(() => hub.stats().subscriptions === 0, 'the next-envelope reach revocation');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain(
        'Restricted after next-envelope removal',
      );
    } finally {
      await restoreCoreMembership(membershipId);
      await hub.close();
    }
  });

  it('drops restricted data already pending when membership removal arrives', async () => {
    const hub = await newHub({ batchWindowMs: 100 });
    const membershipId = await coreMembershipId();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, membershipId));

      await publishDelta(
        action({
          modelId: home.issueOnCore,
          scopes: [`team:${home.teamCore}`],
          data: {
            id: home.issueOnCore,
            teamId: home.teamCore,
            title: 'Restricted while pending',
          },
          syncId: 90,
        }),
      );
      await publishDelta(
        action({
          model: 'team_member',
          action: 'delete',
          modelId: membershipId,
          scopes: [`org:${home.organizationId}`],
          syncId: 91,
        }),
      );
      await waitFor(() => hub.stats().subscriptions === 0, 'the pending reach revocation');
      await new Promise((resolve) => setTimeout(resolve, 130));

      expect(JSON.stringify(wired.socket.frames('delta'))).not.toContain(
        'Restricted while pending',
      );
    } finally {
      await restoreCoreMembership(membershipId);
      await hub.close();
    }
  });

  it('blocks presence delivered after membership removal starts revalidation', async () => {
    const hub = await newHub();
    const membershipId = await coreMembershipId();
    try {
      const wired = await connect(hub, home.readerUserId, home.organizationId);
      await subscribe(wired, [`team:${home.teamCore}`]);
      await db.delete(schema.teamMember).where(eq(schema.teamMember.id, membershipId));

      await publishDelta(
        action({
          model: 'team_member',
          action: 'delete',
          modelId: membershipId,
          scopes: [`org:${home.organizationId}`],
          syncId: 100,
        }),
      );
      await driver().publish(
        REDIS_PRESENCE_CHANNEL,
        JSON.stringify({
          organizationId: home.organizationId,
          scope: `team:${home.teamCore}`,
          kind: 'viewing',
          userId: home.adminUserId,
          name: 'Ada Admin',
          image: null,
          at: new Date().toISOString(),
        }),
      );
      await waitFor(() => hub.stats().subscriptions === 0, 'the presence reach revocation');
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(wired.socket.frames('presence')).toHaveLength(0);
    } finally {
      await restoreCoreMembership(membershipId);
      await hub.close();
    }
  });

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
