import {
  createRealtimeHub,
  fromBunSocket,
  logger,
  type RealtimeHubOptions,
  type RealtimeSession,
  type RealtimeStats,
} from '@orbit/realtime-server';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '@orbit/shared/events';
import type { Server, WebSocketHandler } from 'bun';

export {
  AUTH_TIMEOUT_MS,
  MAX_BUFFERED_BYTES,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  MESSAGE_BURST,
  MESSAGES_PER_SECOND,
  type RealtimeStats,
} from '@orbit/realtime-server';

const SHUTDOWN_GRACE_MS = 1_000;
const MAX_IDLE_TIMEOUT_SECONDS = 960;
const DEFAULT_REALTIME_PATH = '/api/ws';

export interface RealtimeServerOptions extends RealtimeHubOptions {
  port?: number;
  host?: string;
  path?: string;
  allowedOrigins?: readonly string[];
  readinessCheck?: () => boolean | Promise<boolean>;
}

export interface RealtimeServer {
  readonly port: number;
  stats(): RealtimeStats;
  close(): Promise<void>;
}

interface SocketData {
  session: RealtimeSession | null;
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

function jsonStatus(status: 'ok' | 'unavailable', code: number): Response {
  return Response.json({ status }, { status: code });
}

export function normalizeRealtimePath(value: string | undefined): string {
  const path = value ?? DEFAULT_REALTIME_PATH;
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new TypeError('The realtime path must be an absolute URL path without a query or fragment.');
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeAllowedOrigins(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return [];
  const origins = values.map((value) => normalizedOrigin(value));
  if (origins.some((origin) => origin === null)) {
    throw new TypeError('Every allowed realtime origin must be an absolute HTTP or HTTPS origin.');
  }
  return [...new Set(origins as string[])];
}

export function realtimePathMatches(request: Request, path: string): boolean {
  return new URL(request.url).pathname.replace(/\/+$/, '') === path;
}

export function realtimeOriginAllowed(
  request: Request,
  allowedOrigins: readonly string[],
): boolean {
  if (allowedOrigins.length === 0) return true;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const normalized = normalizedOrigin(origin);
  return normalized !== null && allowedOrigins.includes(normalized);
}

export async function createRealtimeServer(
  options: RealtimeServerOptions = {},
): Promise<RealtimeServer> {
  const hub = await createRealtimeHub(options);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const realtimePath = normalizeRealtimePath(options.path);
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);

  const websocket: WebSocketHandler<SocketData> = {
    sendPings: false,
    idleTimeout: idleTimeoutSeconds(heartbeatTimeoutMs, heartbeatIntervalMs),
    open(socket) {
      socket.data.session = hub.accept(fromBunSocket(socket));
    },
    message(socket, raw) {
      socket.data.session?.message(raw.toString());
    },
    pong(socket) {
      socket.data.session?.pong();
    },
    close(socket) {
      socket.data.session?.closed();
    },
  };

  function upgrade(request: Request, self: Server<SocketData>): Response | undefined {
    const data: SocketData = { session: null };
    if (self.upgrade(request, { data })) return;
    return Response.json({ status: 'upgrade_failed' }, { status: 400 });
  }

  async function ready(): Promise<boolean> {
    if (hub.stats().redis !== 'ready') return false;
    if (options.readinessCheck === undefined) return true;
    try {
      return await options.readinessCheck();
    } catch {
      return false;
    }
  }

  const server = Bun.serve<SocketData>({
    port: options.port ?? 0,
    hostname: options.host ?? '0.0.0.0',
    websocket,
    async fetch(request, self) {
      const url = new URL(request.url);
      if (isUpgrade(request)) {
        if (request.method !== 'GET' || !realtimePathMatches(request, realtimePath)) {
          return Response.json({ status: 'not_found' }, { status: 404 });
        }
        if (!realtimeOriginAllowed(request, allowedOrigins)) {
          return Response.json({ status: 'forbidden' }, { status: 403 });
        }
        return upgrade(request, self);
      }
      if (request.method === 'GET' && url.pathname === '/livez') return jsonStatus('ok', 200);
      if (request.method === 'GET' && (url.pathname === '/readyz' || url.pathname === '/health')) {
        return (await ready()) ? jsonStatus('ok', 200) : jsonStatus('unavailable', 503);
      }
      return Response.json({ status: 'not_found' }, { status: 404 });
    },
  });

  async function close(): Promise<void> {
    await hub.close();
    await Promise.race([server.stop(), afterGrace(SHUTDOWN_GRACE_MS)]);
    await server.stop(true);
  }

  const port = server.port ?? 0;
  logger.info('realtime listening', { port });
  return { port, stats: () => hub.stats(), close };
}
