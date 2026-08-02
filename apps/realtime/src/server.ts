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

export interface RealtimeServerOptions extends RealtimeHubOptions {
  port?: number;
  host?: string;
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

export async function createRealtimeServer(
  options: RealtimeServerOptions = {},
): Promise<RealtimeServer> {
  const hub = await createRealtimeHub(options);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;

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
    return new Response(JSON.stringify({ status: 'upgrade_failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const server = Bun.serve<SocketData>({
    port: options.port ?? 0,
    hostname: options.host ?? '0.0.0.0',
    websocket,
    fetch(request, self) {
      if (isUpgrade(request)) return upgrade(request, self);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname.startsWith('/health')) {
        const snapshot = hub.stats();
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
    await hub.close();
    await Promise.race([server.stop(), afterGrace(SHUTDOWN_GRACE_MS)]);
    await server.stop(true);
  }

  const port = server.port ?? 0;
  logger.info('realtime listening', { port });
  return { port, stats: () => hub.stats(), close };
}
