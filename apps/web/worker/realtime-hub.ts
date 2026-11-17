import { DurableObject } from 'cloudflare:workers';
import type { WebSocket as WorkerSocket } from '@cloudflare/workers-types/index.ts';
import { createDatabaseScope } from '@orbit/db';
import {
  type ConnectionSnapshot,
  createLoopbackBus,
  createRealtimeHub,
  errorFields,
  logger,
  type RealtimeHub,
  type RealtimeSession,
  type RealtimeSocket,
  SESSION_SWEEP_INTERVAL_MS,
} from '@orbit/realtime-server';
import { ORG_ROLES } from '@orbit/shared/constants';
import { HEARTBEAT_INTERVAL_MS } from '@orbit/shared/events';
import { z } from 'zod';
import type { WorkerBindings } from './bindings.ts';

const SNAPSHOT_PREFIX = 'connection:';
const PIN_INTERVAL_MS = 5_000;
const TERMINATED_CLOSE_CODE = 1011;
const UNSENDABLE_CLOSE_CODES: readonly number[] = [1005, 1006, 1015];

const attachmentSchema = z.object({ id: z.string().min(1) });

const snapshotSchema = z.object({
  id: z.string().min(1),
  principal: z.object({
    userId: z.string().min(1),
    sessionId: z.string().min(1),
    name: z.string(),
    image: z.string().nullable(),
    organizationId: z.string().min(1),
    role: z.enum(ORG_ROLES),
    teamIds: z.array(z.string()),
  }),
  scopes: z.array(z.string()),
  watermark: z.number(),
});

function snapshotKey(id: string): string {
  return `${SNAPSHOT_PREFIX}${id}`;
}

function attachedId(socket: WorkerSocket): string | null {
  const attachment = attachmentSchema.safeParse(socket.deserializeAttachment());
  return attachment.success ? attachment.data.id : null;
}

export class RealtimeHubObject extends DurableObject<WorkerBindings> {
  private readonly sessions = new Map<string, RealtimeSession>();
  private readonly bus = createLoopbackBus();
  private readonly withDatabase = createDatabaseScope();
  private opening: Promise<RealtimeHub> | undefined;
  private hub: RealtimeHub | undefined;
  private pin: ReturnType<typeof setTimeout> | undefined;
  private sessionsSweptAt = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/deliver' && request.method === 'POST') {
      return await this.deliver(url.searchParams.get('channel') ?? '', await request.text());
    }
    if (url.pathname === '/stats') return Response.json((await this.open()).stats());
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a websocket upgrade.', { status: 426 });
    }
    return await this.connect();
  }

  async webSocketMessage(socket: WorkerSocket, message: string | ArrayBuffer): Promise<void> {
    await this.open();
    const id = attachedId(socket);
    const session = id === null ? undefined : this.sessions.get(id);
    if (session === undefined) return;
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    this.withDatabase(() => session.message(raw));
    this.holdWhileEphemeralStateRemains();
  }

  async webSocketClose(socket: WorkerSocket, code: number, reason: string): Promise<void> {
    await this.release(socket);
    if (UNSENDABLE_CLOSE_CODES.includes(code)) socket.close();
    else socket.close(code, reason);
  }

  async webSocketError(socket: WorkerSocket): Promise<void> {
    await this.release(socket);
  }

  async alarm(): Promise<void> {
    const hub = await this.open();
    hub.heartbeat();
    if (Date.now() - this.sessionsSweptAt >= SESSION_SWEEP_INTERVAL_MS) {
      this.sessionsSweptAt = Date.now();
      try {
        await this.withDatabase(() => hub.sweepSessions());
      } catch (error: unknown) {
        logger.error('session sweep failed', errorFields(error));
      }
    }
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    }
    this.holdWhileEphemeralStateRemains();
  }

  private async deliver(channel: string, message: string): Promise<Response> {
    await this.open();
    await this.withDatabase(() => this.bus.publish(channel, message));
    this.holdWhileEphemeralStateRemains();
    return new Response(null, { status: 202 });
  }

  private async connect(): Promise<Response> {
    const hub = await this.open();
    const pair = new WebSocketPair();
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ id });
    this.sessions.set(id, hub.accept(this.adapt(pair[1], id)));
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
    }
    const upgrade = { status: 101, webSocket: pair[0] };
    return new Response(null, upgrade as unknown as ResponseInit);
  }

  private open(): Promise<RealtimeHub> {
    this.opening ??= this.withDatabase(() => this.start()).catch((error: unknown) => {
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }

  private async start(): Promise<RealtimeHub> {
    const hub = await createRealtimeHub({
      bus: this.bus,
      scheduling: 'manual',
      heartbeatTimeoutMs: Number.POSITIVE_INFINITY,
      onConnectionChange: (snapshot: ConnectionSnapshot): void => {
        this.ctx.waitUntil(this.ctx.storage.put(snapshotKey(snapshot.id), snapshot));
      },
    });
    const stored = await this.ctx.storage.list({ prefix: SNAPSHOT_PREFIX });
    for (const socket of this.ctx.getWebSockets()) {
      const id = attachedId(socket);
      if (id === null) {
        socket.close(TERMINATED_CLOSE_CODE, 'unidentified');
        continue;
      }
      const snapshot = snapshotSchema.safeParse(stored.get(snapshotKey(id)));
      stored.delete(snapshotKey(id));
      const adapted = this.adapt(socket, id);
      this.sessions.set(
        id,
        snapshot.success ? hub.restore(adapted, snapshot.data) : hub.accept(adapted),
      );
    }
    if (stored.size > 0) await this.ctx.storage.delete([...stored.keys()]);
    this.hub = hub;
    return hub;
  }

  private adapt(socket: WorkerSocket, id: string): RealtimeSocket {
    const forget = (): void => {
      this.ctx.waitUntil(this.ctx.storage.delete(snapshotKey(id)));
    };
    return {
      id,
      get readyState(): number {
        return socket.readyState;
      },
      bufferedAmount: () => 0,
      send: (data: string): void => {
        socket.send(data);
      },
      close: (code: number, reason: string): void => {
        forget();
        socket.close(code, reason);
      },
      terminate: (): void => {
        forget();
        socket.close(TERMINATED_CLOSE_CODE, 'terminated');
      },
      ping: (): void => {
        socket.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
      },
    };
  }

  private async release(socket: WorkerSocket): Promise<void> {
    await this.open();
    const id = attachedId(socket);
    if (id === null) return;
    this.sessions.get(id)?.closed();
    this.sessions.delete(id);
    await this.ctx.storage.delete(snapshotKey(id));
  }

  private holdWhileEphemeralStateRemains(): void {
    if (this.pin !== undefined || this.hub === undefined || !this.hub.sweep()) return;
    this.pin = setTimeout(() => {
      this.pin = undefined;
      this.holdWhileEphemeralStateRemains();
    }, PIN_INTERVAL_MS);
  }
}
