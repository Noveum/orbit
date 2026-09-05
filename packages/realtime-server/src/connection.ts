import type { ServerMessage, SyncAction } from '@orbit/shared/events';
import type { ConnectionPrincipal } from './auth.ts';
import { logger } from './logger.ts';
import { type RealtimeSocket, SOCKET_OPEN } from './socket.ts';

export interface ConnectionLimits {
  readonly batchWindowMs: number;
  readonly maxSubscriptions: number;
  readonly maxBufferedBytes: number;
  readonly messageBurst: number;
  readonly messagesPerSecond: number;
}

export interface SocketState {
  connection: Connection | null;
  authenticating: boolean;
  authTimer: ReturnType<typeof setTimeout> | undefined;
}

export class Connection {
  readonly scopes = new Set<string>();
  lastSeenAt = Date.now();
  private readonly pending = new Map<string, SyncAction>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private deltaFlushSuspensionDepth = 0;
  private authorizationFenceDepth = 0;
  private authorizationGeneration = 0;
  private authorizationReady: Promise<void> = Promise.resolve();
  private releaseAuthorization: (() => void) | undefined;
  private tokens: number;
  private refilledAt = Date.now();
  private throttled = false;
  private watermark = 0;

  constructor(
    readonly id: string,
    private readonly socket: RealtimeSocket,
    private current: ConnectionPrincipal,
    private readonly limits: ConnectionLimits,
  ) {
    this.tokens = limits.messageBurst;
  }

  get principal(): ConnectionPrincipal {
    return this.current;
  }

  adoptPrincipal(next: ConnectionPrincipal): void {
    this.current = next;
  }

  heldScopes(): string[] {
    return [...this.scopes];
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
    if (this.socket.readyState !== SOCKET_OPEN) return;
    const buffered = this.socket.bufferedAmount();
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
    const departure =
      action.model === 'issue' && action.action === 'delete' && action.data['departure'] === true;
    const key = `${action.model}|${action.modelId}|${action.action}${departure ? `|${action.syncId}` : ''}`;
    const existing = this.pending.get(key);
    if (existing === undefined || existing.syncId <= action.syncId) {
      this.pending.delete(key);
      this.pending.set(key, action);
    }
    this.scheduleDeltaFlush();
  }

  suspendDeltaFlush(): void {
    this.deltaFlushSuspensionDepth += 1;
    if (this.flushTimer === undefined) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  resumeDeltaFlush(retain: (action: SyncAction) => boolean): void {
    for (const [key, action] of this.pending) {
      if (!retain(action)) this.pending.delete(key);
    }
    if (this.deltaFlushSuspensionDepth > 0) this.deltaFlushSuspensionDepth -= 1;
    this.scheduleDeltaFlush();
  }

  suspendAuthorization(): void {
    this.authorizationGeneration += 1;
    this.authorizationFenceDepth += 1;
    if (this.authorizationFenceDepth > 1) return;
    this.authorizationReady = new Promise((resolve) => {
      this.releaseAuthorization = resolve;
    });
  }

  resumeAuthorization(): void {
    if (this.authorizationFenceDepth === 0) return;
    this.authorizationFenceDepth -= 1;
    if (this.authorizationFenceDepth > 0) return;
    const release = this.releaseAuthorization;
    this.releaseAuthorization = undefined;
    this.authorizationReady = Promise.resolve();
    release?.();
  }

  async waitForAuthorization(): Promise<number> {
    await this.authorizationReady;
    return this.authorizationGeneration;
  }

  authorizationIsCurrent(generation: number): boolean {
    return this.authorizationFenceDepth === 0 && this.authorizationGeneration === generation;
  }

  private scheduleDeltaFlush(): void {
    if (
      this.deltaFlushSuspensionDepth > 0 ||
      this.flushTimer !== undefined ||
      this.pending.size === 0
    )
      return;
    this.flushTimer = setTimeout(() => this.flushDeltas(), this.limits.batchWindowMs);
    this.flushTimer.unref();
  }

  flushDeltas(): void {
    if (this.deltaFlushSuspensionDepth > 0) return;
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
    this.deltaFlushSuspensionDepth = 0;
    this.authorizationFenceDepth = 0;
    this.authorizationGeneration += 1;
    const release = this.releaseAuthorization;
    this.releaseAuthorization = undefined;
    this.authorizationReady = Promise.resolve();
    release?.();
    if (this.socket.readyState === SOCKET_OPEN) {
      this.socket.close(code, reason);
      return;
    }
    this.socket.terminate();
  }

  terminate(): void {
    this.socket.terminate();
  }

  ping(): void {
    if (this.socket.readyState === SOCKET_OPEN) this.socket.ping();
  }
}
