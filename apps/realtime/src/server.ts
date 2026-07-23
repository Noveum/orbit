import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  clientMessageSchema,
  connectionOrganizationIdSchema,
  DELTA_BATCH_WINDOW_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  type PresenceKind,
  presenceMessageSchema,
  REDIS_DELTA_CHANNEL,
  REDIS_PRESENCE_CHANNEL,
  syncActionSchema,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';
import Redis from 'ioredis';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import {
  authenticateConnection,
  authorizeScope,
  type ConnectionPrincipal,
  type ConnectionRejection,
} from './auth.ts';
import { Connection } from './connection.ts';
import { errorFields, logger } from './logger.ts';
import { PresenceStore } from './presence.ts';

export const PRESENCE_TTL_MS = 45_000;
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 256;
export const MAX_BUFFERED_BYTES = 1_048_576;
const SHUTDOWN_GRACE_MS = 1_000;

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

function credentialsFrom(request: IncomingMessage): {
  token: string;
  organizationId: string | null;
} {
  const url = new URL(request.url ?? '/', 'http://realtime.local');
  const stated = connectionOrganizationIdSchema.safeParse(url.searchParams.get('organizationId'));
  return {
    token: url.searchParams.get('token') ?? '',
    organizationId: stated.success ? stated.data : null,
  };
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

export async function createRealtimeServer(
  options: RealtimeServerOptions = {},
): Promise<RealtimeServer> {
  const limits = {
    batchWindowMs: options.batchWindowMs ?? DELTA_BATCH_WINDOW_MS,
    maxSubscriptions: options.maxSubscriptions ?? MAX_SUBSCRIPTIONS_PER_CONNECTION,
    maxBufferedBytes: options.maxBufferedBytes ?? MAX_BUFFERED_BYTES,
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const presenceTtlMs = options.presenceTtlMs ?? PRESENCE_TTL_MS;
  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  const connections = new Map<string, Connection>();
  const presence = new PresenceStore(presenceTtlMs);
  const subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });

  function stats(): RealtimeStats {
    let subscriptions = 0;
    for (const connection of connections.values()) subscriptions += connection.subscriptionCount;
    return { connections: connections.size, subscriptions, redis: subscriber.status };
  }

  function handleHttp(request: IncomingMessage, response: ServerResponse): void {
    if (request.method === 'GET' && (request.url ?? '').startsWith('/health')) {
      const snapshot = stats();
      const healthy = snapshot.redis === 'ready';
      response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', ...snapshot }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not_found' }));
  }

  const httpServer = createServer(handleHttp);
  const wss = new WebSocketServer({ server: httpServer });

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

  async function acceptedScopes(
    connection: Connection,
    requested: readonly string[],
  ): Promise<string[]> {
    const accepted: string[] = [];
    for (const scope of requested) {
      if (connection.scopes.has(scope)) {
        accepted.push(scope);
        continue;
      }
      if (await authorizeScope(scope, connection.principal)) accepted.push(scope);
    }
    return accepted;
  }

  async function handleSubscribe(connection: Connection, requested: string[]): Promise<void> {
    const accepted = await acceptedScopes(connection, requested);
    connection.addScopes(accepted);
    connection.send({ type: 'subscribed', scopes: [...connection.scopes] });
    for (const scope of accepted) {
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

  async function handleMessage(connection: Connection, raw: RawData): Promise<void> {
    connection.lastSeenAt = Date.now();
    const parsed = clientMessageSchema.safeParse(parseJson(raw.toString()));
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
      connection.send({ type: 'subscribed', scopes: [...connection.scopes] });
      return;
    }
    if (message.type === 'subscribe') {
      await handleSubscribe(connection, message.scopes);
      return;
    }
    await handlePresence(connection, message.scope, message.kind);
  }

  function register(socket: WebSocket, principal: ConnectionPrincipal): Connection {
    const connection = new Connection(randomUUID(), socket, principal, limits);
    connections.set(connection.id, connection);
    socket.on('message', (raw) => {
      handleMessage(connection, raw).catch((error: unknown) => {
        logger.error('message handling failed', {
          connectionId: connection.id,
          ...errorFields(error),
        });
      });
    });
    socket.on('pong', () => {
      connection.lastSeenAt = Date.now();
    });
    socket.on('error', (error) => {
      logger.warn('socket error', { connectionId: connection.id, ...errorFields(error) });
    });
    socket.on('close', () => {
      connections.delete(connection.id);
    });
    return connection;
  }

  async function accept(socket: WebSocket, request: IncomingMessage): Promise<void> {
    socket.pause();
    const credentials = credentialsFrom(request);
    const authenticated = await authenticateConnection(
      credentials.token,
      credentials.organizationId,
    );
    if (!authenticated.ok) {
      socket.resume();
      socket.close(CLOSE_CODES[authenticated.reason], authenticated.reason);
      return;
    }
    const principal = authenticated.principal;
    if (socket.readyState !== socket.OPEN) {
      socket.terminate();
      return;
    }
    const connection = register(socket, principal);
    socket.resume();
    connection.send({
      type: 'ready',
      connectionId: connection.id,
      userId: principal.userId,
      organizationId: principal.organizationId,
      scopes: [],
    });
    logger.info('connection ready', {
      connectionId: connection.id,
      userId: principal.userId,
      organizationId: principal.organizationId,
    });
  }

  wss.on('connection', (socket, request) => {
    accept(socket, request).catch((error: unknown) => {
      logger.error('connection rejected', errorFields(error));
      socket.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
    });
  });

  subscriber.on('message', (channel: string, payload: string) => {
    if (channel === REDIS_DELTA_CHANNEL) deliverDelta(payload);
    else if (channel === REDIS_PRESENCE_CHANNEL) deliverPresence(payload);
  });
  subscriber.on('error', (error: unknown) => {
    logger.error('redis subscriber error', errorFields(error));
  });
  publisher.on('error', (error: unknown) => {
    logger.error('redis publisher error', errorFields(error));
  });
  await subscriber.subscribe(REDIS_DELTA_CHANNEL, REDIS_PRESENCE_CHANNEL);

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

  const port = options.port ?? 0;
  await new Promise<void>((resolve) => {
    httpServer.listen(port, options.host ?? '0.0.0.0', resolve);
  });
  const address = httpServer.address() as AddressInfo;

  async function close(): Promise<void> {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    for (const connection of connections.values()) connection.close(1001, 'server shutting down');
    connections.clear();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        for (const client of wss.clients) client.terminate();
        resolve();
      }, SHUTDOWN_GRACE_MS);
      timer.unref();
      wss.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise<void>((resolve) => {
      httpServer.closeAllConnections();
      httpServer.close(() => resolve());
    });
    await Promise.allSettled([subscriber.quit(), publisher.quit()]);
    subscriber.disconnect();
    publisher.disconnect();
  }

  logger.info('realtime listening', { port: address.port });
  return { port: address.port, stats, close };
}
