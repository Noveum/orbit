import type { PresenceMessage } from '@orbit/shared/events';

interface PresenceEntry {
  readonly message: PresenceMessage;
  readonly teamId: string | null;
  readonly expiresAt: number;
}

interface PresenceBoundary {
  readonly teamId: string | null;
  readonly expiresAt: number;
}

export interface PresenceAudience {
  readonly teamId: string | null;
}

export interface PresenceRecipient {
  readonly admin: boolean;
  readonly teamIds: readonly string[];
}

export class PresenceStore {
  private readonly byScope = new Map<string, Map<string, PresenceEntry>>();
  private readonly boundaries = new Map<string, PresenceBoundary>();

  constructor(private readonly ttlMs: number) {}

  record(message: PresenceMessage, audience: PresenceAudience | null, now = Date.now()): boolean {
    const expiresAt = Date.parse(message.at) + this.ttlMs;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    const issuePresence = message.scope.startsWith('issue:');
    if (issuePresence && (audience === null || audience.teamId === null)) return false;
    const boundary = this.boundaries.get(message.scope);
    if (boundary !== undefined && boundary.expiresAt <= now) this.boundaries.delete(message.scope);
    if (
      boundary !== undefined &&
      boundary.expiresAt > now &&
      (audience === null || boundary.teamId === null || audience.teamId !== boundary.teamId)
    ) {
      return false;
    }
    const scope = this.byScope.get(message.scope) ?? new Map<string, PresenceEntry>();
    scope.set(message.userId, { message, teamId: audience?.teamId ?? null, expiresAt });
    this.byScope.set(message.scope, scope);
    return true;
  }

  snapshot(scope: string, recipient: PresenceRecipient, now = Date.now()): PresenceMessage[] {
    const entries = this.byScope.get(scope);
    if (entries === undefined) return [];
    const issuePresence = scope.startsWith('issue:');
    return [...entries.values()]
      .filter(
        (entry) =>
          entry.expiresAt > now &&
          (!issuePresence ||
            (entry.teamId !== null &&
              (recipient.admin || recipient.teamIds.includes(entry.teamId)))),
      )
      .map((entry) => entry.message);
  }

  move(scope: string, teamId: string | null, now = Date.now()): void {
    this.byScope.delete(scope);
    this.boundaries.set(scope, { teamId, expiresAt: now + this.ttlMs });
  }

  sweep(now = Date.now()): void {
    for (const [scope, entries] of this.byScope) {
      for (const [userId, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(userId);
      }
      if (entries.size === 0) this.byScope.delete(scope);
    }
    for (const [scope, boundary] of this.boundaries) {
      if (boundary.expiresAt <= now) this.boundaries.delete(scope);
    }
  }
}
