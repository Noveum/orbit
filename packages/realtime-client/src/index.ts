import type {
  ClientMessage,
  PresenceKind,
  PresenceMessage,
  SyncAction,
} from '@orbit/shared/events';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  serverMessageSchema,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RealtimeClientOptions {
  url: string;
  token: string;
  organizationId: string;
  onDelta?: (actions: SyncAction[]) => void;
  onPresence?: (messages: PresenceMessage[]) => void;
  onStatus?: (status: RealtimeStatus) => void;
  onResume?: (since: number) => void;
  onDenied?: (scopes: string[]) => void;
  maxBackoffMs?: number;
}

export interface RealtimeClient {
  subscribe(scopes: readonly string[]): void;
  unsubscribe(scopes: readonly string[]): void;
  setPresence(scope: string, kind: PresenceKind): void;
  status(): RealtimeStatus;
  seen(): number;
  observe(syncId: number): void;
  close(): void;
}

const BASE_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 15_000;
const NORMAL_CLOSURE = 1000;

const TERMINAL_CLOSE_CODES: readonly number[] = [
  UNAUTHORIZED_CLOSE_CODE,
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
];

function backoffDelay(attempt: number, maxBackoffMs: number): number {
  const exponential = Math.min(maxBackoffMs, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

function endpoint(url: string, token: string, organizationId: string): string {
  const target = new URL(url);
  target.searchParams.set('token', token);
  target.searchParams.set('organizationId', organizationId);
  return target.toString();
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const scopes = new Set<string>();

  let socket: WebSocket | null = null;
  let status: RealtimeStatus = 'connecting';
  let attempt = 0;
  let disposed = false;
  let resumed = false;
  let maxSeenSyncId = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(next: RealtimeStatus): void {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  }

  function send(message: ClientMessage): boolean {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function sendSubscribe(requested: readonly string[]): void {
    if (requested.length === 0) return;
    send({ type: 'subscribe', scopes: [...requested], since: maxSeenSyncId });
  }

  function observe(syncId: number): void {
    if (syncId > maxSeenSyncId) maxSeenSyncId = syncId;
  }

  function receive(payload: string): void {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      return;
    }
    const parsed = serverMessageSchema.safeParse(parsedJson);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'delta') {
      for (const action of message.actions) observe(action.syncId);
      options.onDelta?.(message.actions);
      return;
    }
    if (message.type === 'presence') {
      options.onPresence?.(message.messages);
      return;
    }
    if (message.type === 'subscribed' && message.denied.length > 0) {
      for (const scope of message.denied) scopes.delete(scope);
      options.onDenied?.([...message.denied]);
    }
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer !== undefined) return;
    setStatus('reconnecting');
    const delay = backoffDelay(attempt, maxBackoffMs);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      try {
        connect();
      } catch {
        scheduleReconnect();
      }
    }, delay);
  }

  function connect(): void {
    if (disposed) return;
    const next = new WebSocket(endpoint(options.url, options.token, options.organizationId));
    socket = next;
    next.onopen = () => {
      attempt = 0;
      const reconnected = resumed;
      resumed = true;
      setStatus('open');
      sendSubscribe([...scopes]);
      if (reconnected) options.onResume?.(maxSeenSyncId);
    };
    next.onmessage = (event) => {
      const payload: unknown = event.data;
      if (typeof payload === 'string') receive(payload);
    };
    next.onclose = (event) => {
      if (socket === next) socket = null;
      if (TERMINAL_CLOSE_CODES.includes(event.code)) disposed = true;
      if (disposed) {
        setStatus('closed');
        return;
      }
      scheduleReconnect();
    };
  }

  connect();

  return {
    subscribe(requested: readonly string[]): void {
      const added = requested.filter((scope) => !scopes.has(scope));
      for (const scope of requested) scopes.add(scope);
      sendSubscribe(added);
    },
    unsubscribe(requested: readonly string[]): void {
      for (const scope of requested) scopes.delete(scope);
      if (requested.length > 0) send({ type: 'unsubscribe', scopes: [...requested] });
    },
    setPresence(scope: string, kind: PresenceKind): void {
      send({ type: 'presence', scope, kind });
    },
    status(): RealtimeStatus {
      return status;
    },
    seen(): number {
      return maxSeenSyncId;
    },
    observe,
    close(): void {
      disposed = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      const current = socket;
      socket = null;
      current?.close(NORMAL_CLOSURE, 'client closed');
      setStatus('closed');
    },
  };
}
