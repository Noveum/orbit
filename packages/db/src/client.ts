import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema/index.ts';

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run bun run infra:up.');
}

const poolMaxSchema = z.coerce.number().int().positive().max(1000).default(10);

const poolMax = poolMaxSchema.safeParse(process.env['DATABASE_POOL_MAX'] ?? undefined);

if (!poolMax.success) {
  throw new Error(
    `DATABASE_POOL_MAX must be a positive integer, received "${process.env['DATABASE_POOL_MAX']}".`,
  );
}

const TRANSACTION_POOLER_PORT = 6543;

export function multiplexesConnections(url: string): boolean {
  try {
    return Number(new URL(url).port) === TRANSACTION_POOLER_PORT;
  } catch {
    return false;
  }
}

export function poolCacheKey(url: string, max: number, prepare: boolean): string {
  return JSON.stringify([url, max, prepare]);
}

type Pool = ReturnType<typeof postgres>;

interface CachedPool {
  readonly key: string;
  readonly sql: Pool;
}

const globalForDb = globalThis as unknown as { orbitPool?: CachedPool };

const prepareStatements = !multiplexesConnections(connectionString);
const cacheKey = poolCacheKey(connectionString, poolMax.data, prepareStatements);
const cached = globalForDb.orbitPool;

export const pool =
  cached?.key === cacheKey
    ? cached.sql
    : postgres(connectionString, {
        max: poolMax.data,
        idle_timeout: 30,
        prepare: prepareStatements,
      });

globalForDb.orbitPool = { key: cacheKey, sql: pool };

export const db = drizzle({ client: pool, schema, casing: 'snake_case' });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
