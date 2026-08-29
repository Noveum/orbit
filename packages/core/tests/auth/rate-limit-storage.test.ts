import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  closeAuthRateLimitStorage,
  redisRateLimitStorage,
} from '../../src/auth/rate-limit-storage.ts';

const RULE = { window: 60, max: 3 } as const;
const REDIS_URL = process.env['ORBIT_TEST_REDIS_URL'] ?? '';

function freshKey(): string {
  return `test:${randomUUID()}`;
}

function connectedStorage() {
  if (REDIS_URL.length === 0) {
    throw new Error('ORBIT_TEST_REDIS_URL is unset. Run bun run infra:up before this suite.');
  }
  process.env['REDIS_URL'] = REDIS_URL;
  closeAuthRateLimitStorage();
  const storage = redisRateLimitStorage();
  if (storage === undefined) throw new Error('a storage is expected for a configured url');
  return storage;
}

afterAll(() => {
  closeAuthRateLimitStorage();
});

describe('redisRateLimitStorage', () => {
  beforeEach(() => {
    closeAuthRateLimitStorage();
    process.env['REDIS_URL'] = '';
  });

  it('is absent when no Redis is configured, so better-auth keeps its own store', () => {
    expect(redisRateLimitStorage()).toBeUndefined();
  });

  it('allows a request up to the maximum and refuses the one after it', async () => {
    const storage = connectedStorage();
    const key = freshKey();

    for (let attempt = 0; attempt < RULE.max; attempt += 1) {
      expect(await storage.consume(key, RULE)).toMatchObject({ allowed: true });
    }

    const refused = await storage.consume(key, RULE);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(RULE.window);
  });

  it('counts each key separately', async () => {
    const storage = connectedStorage();
    const busy = freshKey();
    for (let attempt = 0; attempt <= RULE.max; attempt += 1) await storage.consume(busy, RULE);

    expect(await storage.consume(busy, RULE)).toMatchObject({ allowed: false });
    expect(await storage.consume(freshKey(), RULE)).toMatchObject({ allowed: true });
  });

  it('reads back what it counted', async () => {
    const storage = connectedStorage();
    const key = freshKey();
    expect(await storage.get(key)).toBeNull();

    await storage.consume(key, RULE);
    await storage.consume(key, RULE);

    const record = await storage.get(key);
    expect(record).toMatchObject({ key, count: 2 });
    expect(record?.lastRequest).toBeGreaterThan(0);
  });

  it('lets requests through when Redis cannot be reached', async () => {
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6399';
    closeAuthRateLimitStorage();
    const storage = redisRateLimitStorage();
    if (storage === undefined) throw new Error('a storage is expected for a configured url');

    expect(await storage.consume(freshKey(), RULE)).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.get(freshKey())).toBeNull();
    closeAuthRateLimitStorage();
  });
});
