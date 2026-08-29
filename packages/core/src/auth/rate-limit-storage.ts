import { Redis } from 'ioredis';

const KEY_PREFIX = 'orbit:auth:rate-limit:';
const FALLBACK_TTL_SECONDS = 3600;

export interface RateLimitRecord {
  readonly key: string;
  readonly count: number;
  readonly lastRequest: number;
}

export interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfter: number | null;
}

export interface RateLimitStorage {
  get(key: string): Promise<RateLimitRecord | null>;
  set(key: string, value: RateLimitRecord): Promise<void>;
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

const CONSUME_SCRIPT = `
local count = redis.call('HINCRBY', KEYS[1], 'count', 1)
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
redis.call('HSET', KEYS[1], 'lastRequest', ARGV[1])
if count > tonumber(ARGV[3]) then
  return {0, redis.call('PTTL', KEYS[1])}
end
return {1, 0}
`;

let client: Redis | null = null;

function connection(): Redis | null {
  const url = process.env['REDIS_URL'];
  if (url === undefined || url.length === 0) return null;
  if (client === null) {
    const created = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      connectTimeout: 2000,
    });
    created.on('error', (error: Error) => {
      if (client !== created) return;
      console.error('[orbit] auth rate limit redis error:', error.message);
    });
    client = created;
  }
  return client;
}

function toRecord(key: string, fields: Record<string, string>): RateLimitRecord | null {
  const count = Number.parseInt(fields['count'] ?? '', 10);
  const lastRequest = Number.parseInt(fields['lastRequest'] ?? '', 10);
  if (!(Number.isFinite(count) && Number.isFinite(lastRequest))) return null;
  return { key, count, lastRequest };
}

function decisionFrom(result: unknown, window: number): RateLimitDecision {
  if (!Array.isArray(result)) return { allowed: true, retryAfter: null };
  const [allowed, remainingMs] = result;
  if (allowed === 1) return { allowed: true, retryAfter: null };
  const milliseconds = typeof remainingMs === 'number' ? remainingMs : 0;
  const seconds = milliseconds > 0 ? Math.ceil(milliseconds / 1000) : window;
  return { allowed: false, retryAfter: seconds };
}

export function redisRateLimitStorage(): RateLimitStorage | undefined {
  if (connection() === null) return undefined;
  return {
    async get(key: string): Promise<RateLimitRecord | null> {
      const redis = connection();
      if (redis === null) return null;
      try {
        const fields = await redis.hgetall(`${KEY_PREFIX}${key}`);
        return Object.keys(fields).length === 0 ? null : toRecord(key, fields);
      } catch {
        return null;
      }
    },
    async set(key: string, value: RateLimitRecord): Promise<void> {
      const redis = connection();
      if (redis === null) return;
      const target = `${KEY_PREFIX}${key}`;
      try {
        await redis.hset(target, 'count', value.count, 'lastRequest', value.lastRequest);
        if ((await redis.ttl(target)) < 0) await redis.expire(target, FALLBACK_TTL_SECONDS);
      } catch {
        return;
      }
    },
    async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
      const redis = connection();
      if (redis === null) return { allowed: true, retryAfter: null };
      try {
        const result = await redis.eval(
          CONSUME_SCRIPT,
          1,
          `${KEY_PREFIX}${key}`,
          Date.now(),
          rule.window * 1000,
          rule.max,
        );
        return decisionFrom(result, rule.window);
      } catch {
        return { allowed: true, retryAfter: null };
      }
    },
  };
}

export function closeAuthRateLimitStorage(): void {
  const open = client;
  client = null;
  open?.disconnect();
}
