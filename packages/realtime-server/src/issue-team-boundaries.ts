export interface IssueTeamBoundary {
  readonly teamId: string;
  readonly moveSyncId: number | null;
}

interface StoredIssueTeamBoundary extends IssueTeamBoundary {
  readonly expiresAt: number;
}

export class IssueTeamBoundaries {
  private readonly entries = new Map<string, StoredIssueTeamBoundary>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs: number, maxEntries: number) {
    this.ttlMs = Math.max(1, Math.floor(ttlMs));
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, now = Date.now()): IssueTeamBoundary | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { teamId: entry.teamId, moveSyncId: entry.moveSyncId };
  }

  rememberCurrent(key: string, teamId: string, now = Date.now()): void {
    const current = this.get(key, now);
    if (current !== undefined && current.moveSyncId !== null) return;
    this.set(key, { teamId, moveSyncId: null, expiresAt: now + this.ttlMs });
  }

  rememberMove(key: string, syncId: number, teamId: string, now = Date.now()): void {
    const current = this.get(key, now);
    if (current !== undefined && current.moveSyncId !== null && current.moveSyncId > syncId) {
      return;
    }
    this.set(key, { teamId, moveSyncId: syncId, expiresAt: now + this.ttlMs });
  }

  rememberAuthoritative(key: string, syncId: number, teamId: string, now = Date.now()): void {
    const current = this.get(key, now);
    const moveSyncId = Math.max(syncId, current?.moveSyncId ?? syncId);
    this.set(key, { teamId, moveSyncId, expiresAt: now + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private set(key: string, entry: StoredIssueTeamBoundary): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') return;
      this.entries.delete(oldest);
    }
  }
}
