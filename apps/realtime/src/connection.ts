import type { ServerMessage, SyncAction } from '@orbit/shared/events';
import { WebSocket } from 'ws';
import type { ConnectionPrincipal } from './auth.ts';
import { logger } from './logger.ts';

export interface ConnectionLimits {
  readonly batchWindowMs: number;
  readonly maxSubscriptions: number;
  readonly maxBufferedBytes: number;
}

export class Connection {
  readonly scopes = new Set<string>();
  lastSeenAt = Date.now();
  private readonly pending = new Map<string, SyncAction>();
  private flushTimer: NodeJS.Timeout | undefined;

  constructor(
    readonly id: string,
    private readonly socket: WebSocket,
    readonly principal: ConnectionPrincipal,
    private readonly limits: ConnectionLimits,
  ) {}

  get organizationId(): string {
    return this.principal.organizationId;
  }

  get subscriptionCount(): number {
    return this.scopes.size;
  }

  addScopes(scopes: readonly string[]): void {
    for (const scope of scopes) {
      if (this.scopes.size >= this.limits.maxSubscriptions) return;
      this.scopes.add(scope);
    }
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
    if (this.socket.bufferedAmount > this.limits.maxBufferedBytes) {
      logger.warn('dropping slow connection', {
        connectionId: this.id,
        bufferedAmount: this.socket.bufferedAmount,
      });
      this.socket.terminate();
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  queueDelta(action: SyncAction): void {
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
