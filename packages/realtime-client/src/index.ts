import type {
  ClientMessage,
  PresenceKind,
  PresenceMessage,
  SyncAction,
} from '@orbit/shared/events';
import { serverMessageSchema } from '@orbit/shared/events';

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RealtimeClientOptions {
  url: string;
  token: string;
  onDelta?: (actions: SyncAction[]) => void;
  onPresence?: (messages: PresenceMessage[]) => void;
  onStatus?: (status: RealtimeStatus) => void;
  maxBackoffMs?: number;
}

export interface RealtimeClient {
  subscribe(scopes: readonly string[]): void;
  unsubscribe(scopes: readonly string[]): void;
  setPresence(scope: string, kind: PresenceKind): void;
  status(): RealtimeStatus;
  close(): void;
}

const BASE_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 15_000;
const NORMAL_CLOSURE = 1000;

function backoffDelay(attempt: number, maxBackoffMs: number): number {
  const exponential = Math.min(maxBackoffMs, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

function endpoint(url: string, token: string): string {
  const target = new URL(url);
  target.searchParams.set('token', token);
  return target.toString();
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const scopes = new Set<string>();

  let socket: WebSocket | null = null;
  let status: RealtimeStatus = 'connecting';
  let attempt = 0;
  let disposed = false;
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
    if (message.type === 'delta') options.onDelta?.(message.actions);
    else if (message.type === 'presence') options.onPresence?.(message.messages);
  }

  function scheduleReconnect(): void {
    if (disposed || reconnectTimer !== undefined) return;
    setStatus('reconnecting');
    const delay = backoffDelay(attempt, maxBackoffMs);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function connect(): void {
    if (disposed) return;
    const next = new WebSocket(endpoint(options.url, options.token));
    socket = next;
    next.onopen = () => {
      attempt = 0;
      setStatus('open');
      if (scopes.size > 0) send({ type: 'subscribe', scopes: [...scopes] });
    };
    next.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') receive(event.data);
    };
    next.onclose = () => {
      if (socket === next) socket = null;
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
      if (added.length > 0) send({ type: 'subscribe', scopes: added });
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
