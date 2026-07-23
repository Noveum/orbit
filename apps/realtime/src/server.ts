import { randomUUID } from 'node:crypto';
import {
  clientMessageSchema,
  connectionOrganizationIdSchema,
  DELTA_BATCH_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  PRESENCE_TTL_MS,
  type PresenceKind,
  presenceMessageSchema,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
  type SyncAction,
  syncActionSchema,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';
import { RedisClient, type Server, type ServerWebSocket, type WebSocketHandler } from 'bun';
import { z } from 'zod';
import {
  authenticateConnection,
  authorizeScope,
  type ConnectionRejection,
  memberDeleteSchema,
  membershipStillValid,
} from './auth.ts';
import { Connection, type SocketData } from './connection.ts';
import { errorFields, logger } from './logger.ts';
import { PresenceStore } from './presence.ts';

export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 256;
export const MAX_BUFFERED_BYTES = 1_048_576;
export const MESSAGE_BURST = 60;
export const MESSAGES_PER_SECOND = 20;
const SHUTDOWN_GRACE_MS = 1_000;
const MAX_IDLE_TIMEOUT_SECONDS = 960;

export interface RealtimeServerOptions {
  port?: number;
  host?: string;
  redisUrl?: string;
  batchWindowMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  presenceTtlMs?: number;
  maxSubscriptions?: number;
  maxBufferedBytes?: number;
  messageBurst?: number;
  messagesPerSecond?: number;
}

export interface RealtimeStats {
  connections: number;
  subscriptions: number;
  redis: string;
}

export interface RealtimeServer {
  readonly port: number;
  stats(): RealtimeStats;
  close(): Promise<void>;
}

const deltaEnvelopeSchema = z.union([
  z.array(z.unknown()).min(1),
  z.unknown().transform((action) => [action]),
]);

const CLOSE_CODES: Record<ConnectionRejection, number> = {
  unauthorized: UNAUTHORIZED_CLOSE_CODE,
  organization_forbidden: ORGANIZATION_FORBIDDEN_CLOSE_CODE,
};

interface ConnectionCredentials {
  readonly token: string;
  readonly organizationId: string | null;
}

function credentialsFrom(url: URL): ConnectionCredentials | null {
  const token = url.searchParams.get('token') ?? '';
  const stated = url.searchParams.get('organizationId');
  if (stated === null) return { token, organizationId: null };
  const parsed = connectionOrganizationIdSchema.safeParse(stated);
  if (!parsed.success) return null;
  return { token, organizationId: parsed.data };
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

function isUpgrade(request: Request): boolean {
  return (request.headers.get('upgrade') ?? '').toLowerCase() === 'websocket';
}

function idleTimeoutSeconds(heartbeatTimeoutMs: number, heartbeatIntervalMs: number): number {
  const seconds = Math.ceil((heartbeatTimeoutMs + heartbeatIntervalMs) / 1_000);
  return Math.min(MAX_IDLE_TIMEOUT_SECONDS, Math.max(1, seconds));
}

function afterGrace(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

export async function createRealtimeServer(
  options: RealtimeServerOptions = {},
): Promise<RealtimeServer> {
  const limits = {
    batchWindowMs: options.batchWindowMs ?? DELTA_BATCH_WINDOW_MS,
    maxSubscriptions: options.maxSubscriptions ?? MAX_SUBSCRIPTIONS_PER_CONNECTION,
    maxBufferedBytes: options.maxBufferedBytes ?? MAX_BUFFERED_BYTES,
    messageBurst: options.messageBurst ?? MESSAGE_BURST,
    messagesPerSecond: options.messagesPerSecond ?? MESSAGES_PER_SECOND,
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  const connections = new Map<string, Connection>();
  const presence = new PresenceStore(presenceTtlMs);
  const subscriber = new RedisClient(redisUrl);
  const publisher = new RedisClient(redisUrl);

  function stats(): RealtimeStats {
    let subscriptions = 0;
    for (const connection of connections.values()) subscriptions += connection.subscriptionCount;
    return {
      connections: connections.size,
      subscriptions,
      redis: subscriber.connected ? 'ready' : 'disconnected',
    };
  }

  async function revalidate(connection: Connection): Promise<void> {
    let valid = false;
    try {
      valid = await membershipStillValid(connection.principal);
    } catch (error: unknown) {
      logger.error('membership revalidation failed, closing to fail closed', {
        connectionId: connection.id,
        ...errorFields(error),
      });
    }
    if (valid) return;
    logger.info('closing connection for a removed member', {
      connectionId: connection.id,
      userId: connection.principal.userId,
      organizationId: connection.principal.organizationId,
    });
    connections.delete(connection.id);
    connection.close(ORGANIZATION_FORBIDDEN_CLOSE_CODE, 'membership_revoked');
  }

  function revalidateAffected(action: SyncAction): void {
    if (action.model !== 'member' || action.action !== 'delete') return;
    const removed = memberDeleteSchema.safeParse(action.data);
    if (!removed.success) return;
    for (const connection of connections.values()) {
      if (connection.organizationId !== action.organizationId) continue;
      if (connection.principal.userId !== removed.data.userId) continue;
      revalidate(connection).catch((error: unknown) => {
        logger.error('membership revalidation failed', {
          connectionId: connection.id,
          ...errorFields(error),
        });
      });
    }
  }

  function deliverDelta(payload: string): void {
    const envelope = deltaEnvelopeSchema.safeParse(parseJson(payload));
    if (!envelope.success) {
      logger.warn('discarded malformed delta', { channel: REDIS_DELTA_CHANNEL });
      return;
    }
    for (const entry of envelope.data) {
      const parsed = syncActionSchema.safeParse(entry);
      if (!parsed.success) {
        logger.warn('discarded malformed delta action', { channel: REDIS_DELTA_CHANNEL });
        continue;
      }
      const action = parsed.data;
      for (const connection of connections.values()) {
        if (connection.matches(action.scopes, action.organizationId)) connection.queueDelta(action);
      }
      revalidateAffected(action);
    }
  }

  function deliverPresence(payload: string): void {
    const parsed = presenceMessageSchema.safeParse(parseJson(payload));
    if (!parsed.success) {
      logger.warn('discarded malformed presence', { channel: REDIS_PRESENCE_CHANNEL });
      return;
    }
    const message = parsed.data;
    presence.record(message);
    for (const connection of connections.values()) {
      if (connection.principal.userId === message.userId) continue;
      if (!connection.matches([message.scope], message.organizationId)) continue;
      connection.send({ type: 'presence', messages: [message] });
    }
  }

  async function partitionScopes(
    connection: Connection,
    requested: readonly string[],
  ): Promise<{ accepted: string[]; denied: string[] }> {
    const accepted: string[] = [];
    const denied: string[] = [];
    for (const scope of requested) {
      if (connection.scopes.has(scope)) {
        accepted.push(scope);
        continue;
      }
      if (await authorizeScope(scope, connection.principal)) accepted.push(scope);
      else denied.push(scope);
    }
    return { accepted, denied };
  }

  async function handleSubscribe(connection: Connection, requested: string[]): Promise<void> {
    const { accepted, denied } = await partitionScopes(connection, requested);
    const overflow = connection.addScopes(accepted);
    connection.send({
      type: 'subscribed',
      scopes: [...connection.scopes],
      denied: [...denied, ...overflow],
    });
    for (const scope of accepted) {
      if (!connection.scopes.has(scope)) continue;
      const messages = presence
        .snapshot(scope)
        .filter((message) => message.userId !== connection.principal.userId);
      if (messages.length > 0) connection.send({ type: 'presence', messages });
    }
  }

  async function handlePresence(
    connection: Connection,
    scope: string,
    kind: PresenceKind,
  ): Promise<void> {
    const allowed =
      connection.scopes.has(scope) || (await authorizeScope(scope, connection.principal));
    if (!allowed) {
      connection.send({ type: 'error', code: 'forbidden_scope', message: 'Scope not allowed.' });
      return;
    }
    const message = {
      organizationId: connection.organizationId,
      scope,
      kind,
      userId: connection.principal.userId,
      name: connection.principal.name,
      image: connection.principal.image,
      at: new Date().toISOString(),
    };
    await publisher.publish(REDIS_PRESENCE_CHANNEL, JSON.stringify(message));
  }

  async function handleMessage(connection: Connection, raw: string): Promise<void> {
    connection.lastSeenAt = Date.now();
    if (!connection.takeToken()) {
      if (connection.announceThrottled()) {
        connection.send({
          type: 'error',
          code: 'rate_limited',
          message: 'Too many messages, slow down.',
        });
      }
      return;
    }
    connection.clearThrottle();
    const parsed = clientMessageSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      connection.send({
        type: 'error',
        code: 'invalid_message',
        message: 'Message did not match the client protocol.',
      });
      return;
    }
    const message = parsed.data;
    if (message.type === 'ping') {
      connection.send({ type: 'pong', at: new Date().toISOString() });
      return;
    }
    if (message.type === 'unsubscribe') {
      connection.removeScopes(message.scopes);
      connection.send({ type: 'subscribed', scopes: [...connection.scopes], denied: [] });
      return;
    }
    if (message.type === 'subscribe') {
      if (message.since !== undefined) connection.advanceWatermark(message.since);
      await handleSubscribe(connection, message.scopes);
      return;
    }
    await handlePresence(connection, message.scope, message.kind);
  }

  function connectionOf(socket: ServerWebSocket<SocketData>): Connection | null {
    const data = socket.data;
    return 'rejection' in data ? null : data.connection;
  }

  async function socketDataFor(request: Request): Promise<SocketData> {
    const credentials = credentialsFrom(new URL(request.url));
    if (credentials === null) return { rejection: 'organization_forbidden' };
    const authenticated = await authenticateConnection(
      credentials.token,
      credentials.organizationId,
    );
    if (!authenticated.ok) return { rejection: authenticated.reason };
    return { principal: authenticated.principal, connection: null };
  }

  async function upgrade(
    request: Request,
    server: Server<SocketData>,
  ): Promise<Response | undefined> {
    let data: SocketData;
    try {
      data = await socketDataFor(request);
    } catch (error: unknown) {
      logger.error('connection rejected', errorFields(error));
      data = { rejection: 'unauthorized' };
    }
    if (server.upgrade(request, { data })) return;
    return new Response(JSON.stringify({ status: 'upgrade_failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const websocket: WebSocketHandler<SocketData> = {
    sendPings: false,
    idleTimeout: idleTimeoutSeconds(heartbeatTimeoutMs, heartbeatIntervalMs),
    open(socket) {
      const data = socket.data;
      if ('rejection' in data) {
        socket.close(CLOSE_CODES[data.rejection], data.rejection);
        return;
      }
      const connection = new Connection(randomUUID(), socket, data.principal, limits);
      data.connection = connection;
      connections.set(connection.id, connection);
      connection.send({
        type: 'ready',
        connectionId: connection.id,
        userId: data.principal.userId,
        organizationId: data.principal.organizationId,
        scopes: [],
      });
      logger.info('connection ready', {
        connectionId: connection.id,
        userId: data.principal.userId,
        organizationId: data.principal.organizationId,
      });
    },
    message(socket, raw) {
      const connection = connectionOf(socket);
      if (connection === null) return;
      handleMessage(connection, raw.toString()).catch((error: unknown) => {
        logger.error('message handling failed', {
          connectionId: connection.id,
          ...errorFields(error),
        });
      });
    },
    pong(socket) {
      const connection = connectionOf(socket);
      if (connection === null) return;
      connection.lastSeenAt = Date.now();
    },
    close(socket) {
      const connection = connectionOf(socket);
      if (connection === null) return;
      connections.delete(connection.id);
    },
  };

  await subscriber.subscribe(
    [REDIS_DELTA_CHANNEL, REDIS_PRESENCE_CHANNEL],
    (message: string, channel: string) => {
      if (channel === REDIS_DELTA_CHANNEL) deliverDelta(message);
      else if (channel === REDIS_PRESENCE_CHANNEL) deliverPresence(message);
    },
  );
  let closing = false;
  subscriber.onclose = (error: Error): void => {
    if (!closing) logger.error('redis subscriber error', errorFields(error));
  };
  publisher.onclose = (error: Error): void => {
    if (!closing) logger.error('redis publisher error', errorFields(error));
  };

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (now - connection.lastSeenAt > heartbeatTimeoutMs) {
        logger.warn('terminating stale connection', { connectionId: connection.id });
        connections.delete(connection.id);
        connection.terminate();
        continue;
      }
      connection.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  const sweeper = setInterval(() => presence.sweep(), Math.max(1_000, presenceTtlMs / 3));
  sweeper.unref();

  const server = Bun.serve<SocketData>({
    port: options.port ?? 0,
    hostname: options.host ?? '0.0.0.0',
    websocket,
    fetch(request, self) {
      if (isUpgrade(request)) return upgrade(request, self);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname.startsWith('/health')) {
        const snapshot = stats();
        const healthy = snapshot.redis === 'ready';
        return Response.json(
          { status: healthy ? 'ok' : 'degraded', ...snapshot },
          { status: healthy ? 200 : 503 },
        );
      }
      return Response.json({ status: 'not_found' }, { status: 404 });
    },
  });

  async function close(): Promise<void> {
    closing = true;
    clearInterval(heartbeat);
    clearInterval(sweeper);
    for (const connection of connections.values()) connection.close(1001, 'server shutting down');
    connections.clear();
    await Promise.race([server.stop(), afterGrace(SHUTDOWN_GRACE_MS)]);
    await server.stop(true);
    subscriber.close();
    publisher.close();
  }

  const port = server.port ?? 0;
  logger.info('realtime listening', { port });
  return { port, stats, close };
}
