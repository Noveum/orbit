import type { PresenceMessage } from '@orbit/shared/events';

interface PresenceEntry {
  readonly message: PresenceMessage;
  readonly expiresAt: number;
}

export class PresenceStore {
  private readonly byScope = new Map<string, Map<string, PresenceEntry>>();

  constructor(private readonly ttlMs: number) {}

  record(message: PresenceMessage, now = Date.now()): void {
    const scope = this.byScope.get(message.scope) ?? new Map<string, PresenceEntry>();
    scope.set(message.userId, { message, expiresAt: now + this.ttlMs });
    this.byScope.set(message.scope, scope);
  }

  snapshot(scope: string, now = Date.now()): PresenceMessage[] {
    const entries = this.byScope.get(scope);
    if (entries === undefined) return [];
    return [...entries.values()]
      .filter((entry) => entry.expiresAt > now)
      .map((entry) => entry.message);
  }

  sweep(now = Date.now()): void {
    for (const [scope, entries] of this.byScope) {
      for (const [userId, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(userId);
      }
      if (entries.size === 0) this.byScope.delete(scope);
    }
  }
}
