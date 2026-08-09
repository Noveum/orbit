import type {
  AuthMessage,
  ClientMessage,
  DeliveredSyncAction,
  PresenceKind,
  PresenceMessage,
  SyncAction,
} from '@orbit/shared/events';
import {
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
  SESSION_REVOKED_CLOSE_CODE,
  serverMessageSchema,
  tolerantDeltaMessageSchema,
  UNAUTHORIZED_CLOSE_CODE,
} from '@orbit/shared/events';

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface RealtimeClientOptions {
  url: string;
  fetchTicket: () => Promise<string>;
  onDelta?: (actions: SyncAction[]) => void;
  onPresence?: (messages: PresenceMessage[]) => void;
  onStatus?: (status: RealtimeStatus) => void;
  onResume?: (since: number) => void;
  onDenied?: (scopes: string[]) => void;
  onTerminal?: (code: number) => void;
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
  SESSION_REVOKED_CLOSE_CODE,
  ORGANIZATION_FORBIDDEN_CLOSE_CODE,
];

function backoffDelay(attempt: number, maxBackoffMs: number): number {
  const exponential = Math.min(maxBackoffMs, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
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

  function handleReady(): void {
    attempt = 0;
    const reconnected = resumed;
    resumed = true;
    setStatus('open');
    sendSubscribe([...scopes]);
    if (reconnected) options.onResume?.(maxSeenSyncId);
  }

  function handleDelta(delivered: DeliveredSyncAction[]): void {
    const actions: SyncAction[] = [];
    for (const entry of delivered) {
      observe(entry.syncId);
      if ('unsupported' in entry) continue;
      actions.push(entry);
    }
    if (actions.length === 0) return;
    options.onDelta?.(actions);
  }

  function handleDenied(denied: readonly string[]): void {
    for (const scope of denied) scopes.delete(scope);
    options.onDenied?.([...denied]);
  }

  function receive(payload: string): void {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(payload);
    } catch {
      return;
    }
    const parsed = serverMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const tolerated = tolerantDeltaMessageSchema.safeParse(parsedJson);
      if (tolerated.success) handleDelta(tolerated.data.actions);
      return;
    }
    const message = parsed.data;
    if (message.type === 'ready') {
      handleReady();
      return;
    }
    if (message.type === 'delta') {
      handleDelta(message.actions);
      return;
    }
    if (message.type === 'presence') {
      options.onPresence?.(message.messages);
      return;
    }
    if (message.type === 'subscribed' && message.denied.length > 0) {
      handleDenied(message.denied);
    }
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
    openSocket().catch(() => scheduleReconnect());
  }

  async function openSocket(): Promise<void> {
    let ticket: string;
    try {
      ticket = await options.fetchTicket();
    } catch {
      scheduleReconnect();
      return;
    }
    if (disposed) return;
    try {
      const next = new WebSocket(options.url);
      socket = next;
      next.onopen = () => {
        next.send(JSON.stringify({ type: 'auth', ticket } satisfies AuthMessage));
      };
      next.onmessage = (event) => {
        const payload: unknown = event.data;
        if (typeof payload === 'string') receive(payload);
      };
      next.onclose = (event) => {
        if (socket === next) socket = null;
        const terminal = TERMINAL_CLOSE_CODES.includes(event.code);
        if (terminal) disposed = true;
        if (disposed) {
          setStatus('closed');
          if (terminal) options.onTerminal?.(event.code);
          return;
        }
        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
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
