import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run pnpm infra:up.');
}

const globalForDb = globalThis as unknown as { orbitPool?: Pool };

export const pool =
  globalForDb.orbitPool ??
  new Pool({
    connectionString,
    max: Number.parseInt(process.env['DATABASE_POOL_MAX'] ?? '10', 10),
    idleTimeoutMillis: 30_000,
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForDb.orbitPool = pool;
}

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
