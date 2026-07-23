import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema/index.ts';

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run bun run infra:up.');
}

const globalForDb = globalThis as unknown as { orbitPool?: SQL };

export const pool =
  globalForDb.orbitPool ??
  new SQL(connectionString, {
    max: Number.parseInt(process.env['DATABASE_POOL_MAX'] ?? '10', 10),
    idleTimeout: 30,
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForDb.orbitPool = pool;
}

export const db = drizzle({ client: pool, schema, casing: 'snake_case' });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
