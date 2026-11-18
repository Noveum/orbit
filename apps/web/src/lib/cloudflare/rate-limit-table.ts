import type { RateLimitDecision, RateLimitRecord, RateLimitRule } from '@orbit/core';

const FALLBACK_TTL_MS = 3_600_000;

export interface SqlRows {
  toArray(): Record<string, unknown>[];
}

export interface SqlExecutor {
  exec(query: string, ...bindings: (string | number)[]): SqlRows;
}

interface StoredLimit {
  readonly count: number;
  readonly lastRequest: number;
  readonly expiresAt: number;
}

function toInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export class RateLimitTable {
  constructor(private readonly sql: SqlExecutor) {
    sql.exec(
      'create table if not exists rate_limit (key text primary key, count integer not null, last_request integer not null, expires_at integer not null)',
    );
  }

  get(key: string, now = Date.now()): RateLimitRecord | null {
    const stored = this.read(key, now);
    return stored === null ? null : { key, count: stored.count, lastRequest: stored.lastRequest };
  }

  set(value: RateLimitRecord, now = Date.now()): void {
    const stored = this.read(value.key, now);
    this.write(value.key, {
      count: value.count,
      lastRequest: value.lastRequest,
      expiresAt: stored?.expiresAt ?? now + FALLBACK_TTL_MS,
    });
  }

  consume(key: string, rule: RateLimitRule, now = Date.now()): RateLimitDecision {
    this.sql.exec('delete from rate_limit where expires_at <= ?', now);
    const stored = this.read(key, now);
    const windowMs = rule.window * 1000;
    const next: StoredLimit = {
      count: (stored?.count ?? 0) + 1,
      lastRequest: now,
      expiresAt: stored?.expiresAt ?? now + windowMs,
    };
    this.write(key, next);
    if (next.count <= rule.max) return { allowed: true, retryAfter: null };
    const remainingMs = next.expiresAt - now;
    return {
      allowed: false,
      retryAfter: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : rule.window,
    };
  }

  private read(key: string, now: number): StoredLimit | null {
    const [row] = this.sql
      .exec('select count, last_request, expires_at from rate_limit where key = ?', key)
      .toArray();
    if (row === undefined) return null;
    const count = toInteger(row['count']);
    const lastRequest = toInteger(row['last_request']);
    const expiresAt = toInteger(row['expires_at']);
    if (count === null || lastRequest === null || expiresAt === null) return null;
    return expiresAt > now ? { count, lastRequest, expiresAt } : null;
  }

  private write(key: string, value: StoredLimit): void {
    this.sql.exec(
      'insert into rate_limit (key, count, last_request, expires_at) values (?, ?, ?, ?) on conflict (key) do update set count = excluded.count, last_request = excluded.last_request, expires_at = excluded.expires_at',
      key,
      value.count,
      value.lastRequest,
      value.expiresAt,
    );
  }
}
