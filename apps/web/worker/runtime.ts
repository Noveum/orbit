import {
  type RateLimitDecision,
  type RateLimitRecord,
  type RateLimitRule,
  registerAuthRateLimitStorage,
  registerRealtimeTransport,
} from '@orbit/core';
import { registerPrivateDatabaseProxy } from '@orbit/db';
import { z } from 'zod';
import { registerHostedRealtime } from '../src/lib/realtime/hub.ts';
import { authRateLimiter, bindings, realtimeHub } from './bindings.ts';

const INTERNAL_ORIGIN = 'https://durable-object.internal';

const recordSchema = z
  .object({ key: z.string(), count: z.number(), lastRequest: z.number() })
  .nullable();

const statsSchema = z.object({
  connections: z.number(),
  subscriptions: z.number(),
  redis: z.string(),
});

const decisionSchema = z.object({ allowed: z.boolean(), retryAfter: z.number().nullable() });

async function askRateLimiter(operation: string, body: unknown): Promise<unknown> {
  const response = await authRateLimiter().fetch(`${INTERNAL_ORIGIN}/${operation}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`The auth rate limiter answered ${response.status}.`);
  return await response.json();
}

export function connectWorkerRuntime(): void {
  const hyperdrive = bindings().HYPERDRIVE;
  if (hyperdrive !== undefined) registerPrivateDatabaseProxy(hyperdrive.connectionString);

  registerRealtimeTransport({
    async publish(channel: string, message: string): Promise<void> {
      const target = new URL('/deliver', INTERNAL_ORIGIN);
      target.searchParams.set('channel', channel);
      const response = await realtimeHub().fetch(target.toString(), {
        method: 'POST',
        body: message,
      });
      if (!response.ok) throw new Error(`The realtime hub answered ${response.status}.`);
    },
  });

  registerHostedRealtime(async () => {
    const response = await realtimeHub().fetch(`${INTERNAL_ORIGIN}/stats`);
    if (!response.ok) throw new Error(`The realtime hub answered ${response.status}.`);
    return statsSchema.parse(await response.json());
  });

  registerAuthRateLimitStorage({
    async get(key: string): Promise<RateLimitRecord | null> {
      try {
        return recordSchema.parse(await askRateLimiter('get', { key }));
      } catch (error: unknown) {
        console.error('[orbit] auth rate limit lookup failed:', error);
        return null;
      }
    },
    async set(key: string, value: RateLimitRecord): Promise<void> {
      try {
        await askRateLimiter('set', { ...value, key });
      } catch (error: unknown) {
        console.error('[orbit] auth rate limit write failed:', error);
      }
    },
    async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
      try {
        return decisionSchema.parse(await askRateLimiter('consume', { key, rule }));
      } catch (error: unknown) {
        console.error('[orbit] auth rate limit check failed:', error);
        return { allowed: true, retryAfter: null };
      }
    },
  });
}
