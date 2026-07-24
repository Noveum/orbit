import type { ServerMessage, SyncAction } from '@orbit/shared/events';
import type { ServerWebSocket } from 'bun';
import type { ConnectionPrincipal, ConnectionRejection } from './auth.ts';
import { logger } from './logger.ts';

export interface ConnectionLimits {
  readonly batchWindowMs: number;
  readonly maxSubscriptions: number;
  readonly maxBufferedBytes: number;
  readonly messageBurst: number;
  readonly messagesPerSecond: number;
}

export type SocketData =
  | { readonly rejection: ConnectionRejection }
  | { readonly principal: ConnectionPrincipal; connection: Connection | null };

export class Connection {
  readonly scopes = new Set<string>();
  lastSeenAt = Date.now();
  private readonly pending = new Map<string, SyncAction>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private tokens: number;
  private refilledAt = Date.now();
  private throttled = false;
  private watermark = 0;

  constructor(
    readonly id: string,
    private readonly socket: ServerWebSocket<SocketData>,
    readonly principal: ConnectionPrincipal,
    private readonly limits: ConnectionLimits,
  ) {
    this.tokens = limits.messageBurst;
  }

  takeToken(now = Date.now()): boolean {
    const elapsedSeconds = Math.max(0, now - this.refilledAt) / 1_000;
    this.refilledAt = now;
    this.tokens = Math.min(
      this.limits.messageBurst,
      this.tokens + elapsedSeconds * this.limits.messagesPerSecond,
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  announceThrottled(): boolean {
    if (this.throttled) return false;
    this.throttled = true;
    return true;
  }

  clearThrottle(): void {
    this.throttled = false;
  }

  get organizationId(): string {
    return this.principal.organizationId;
  }

  get subscriptionCount(): number {
    return this.scopes.size;
  }

  addScopes(scopes: readonly string[]): string[] {
    const rejected: string[] = [];
    for (const scope of scopes) {
      if (this.scopes.has(scope)) continue;
      if (this.scopes.size >= this.limits.maxSubscriptions) {
        rejected.push(scope);
        continue;
      }
      this.scopes.add(scope);
    }
    return rejected;
  }

  removeScopes(scopes: readonly string[]): void {
    for (const scope of scopes) this.scopes.delete(scope);
  }

  matches(scopes: readonly string[], organizationId: string): boolean {
    if (organizationId !== this.organizationId) return false;
    return scopes.some((scope) => this.scopes.has(scope));
  }

  send(message: ServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const buffered = this.socket.getBufferedAmount();
    if (buffered > this.limits.maxBufferedBytes) {
      logger.warn('dropping slow connection', { connectionId: this.id, bufferedAmount: buffered });
      this.socket.terminate();
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  advanceWatermark(syncId: number): void {
    if (syncId > this.watermark) this.watermark = syncId;
  }

  queueDelta(action: SyncAction): void {
    if (action.syncId <= this.watermark) return;
    const key = `${action.model}|${action.modelId}|${action.action}`;
    const existing = this.pending.get(key);
    if (existing === undefined || existing.syncId <= action.syncId) {
      this.pending.set(key, action);
    }
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => this.flushDeltas(), this.limits.batchWindowMs);
    this.flushTimer.unref();
  }

  flushDeltas(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.pending.size === 0) return;
    const actions = [...this.pending.values()].sort((left, right) => left.syncId - right.syncId);
    this.pending.clear();
    this.send({ type: 'delta', actions });
  }

  close(code: number, reason: string): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.pending.clear();
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(code, reason);
      return;
    }
    this.socket.terminate();
  }

  terminate(): void {
    this.socket.terminate();
  }

  ping(): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.ping();
  }
}
