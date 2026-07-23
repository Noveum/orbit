import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
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

const globalForDb = globalThis as unknown as { orbitPool?: SQL };

export const pool =
  globalForDb.orbitPool ??
  new SQL(connectionString, {
    max: poolMax.data,
    idleTimeout: 30,
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForDb.orbitPool = pool;
}

export const db = drizzle({ client: pool, schema, casing: 'snake_case' });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
