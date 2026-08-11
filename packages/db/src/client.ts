import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema/index.ts';

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run bun run infra:up.');
}

const poolMaxSchema = z.coerce.number().int().positive().max(1000).default(10);
const preparedStatementsSchema = z.enum(['true', 'false']).default('false');

function trimUrlControlEdges(url: string): string {
  let start = 0;
  while (start < url.length && url.charCodeAt(start) <= 0x20) start += 1;

  let end = url.length;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end -= 1;

  return url.slice(start, end);
}

const poolMax = poolMaxSchema.safeParse(process.env['DATABASE_POOL_MAX'] ?? undefined);

if (!poolMax.success) {
  throw new Error(
    `DATABASE_POOL_MAX must be a positive integer, received "${process.env['DATABASE_POOL_MAX']}".`,
  );
}

export function resolvePreparedStatements(url: string, configured: string | undefined): boolean {
  const normalizedUrl = trimUrlControlEdges(url).replace(/[\t\n\r]/g, '');
  const authority = normalizedUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  const hostAuthority = authority.slice(authority.lastIndexOf('@') + 1);
  if (/%2c/i.test(hostAuthority)) {
    throw new Error(
      'DATABASE_URL must use literal host separators; a percent-encoded comma is not supported.',
    );
  }
  const fragmentStart = normalizedUrl.indexOf('#');
  const queryStart = normalizedUrl.indexOf('?');
  const queryEnd = fragmentStart === -1 ? normalizedUrl.length : fragmentStart;
  const query =
    queryStart === -1 || queryStart > queryEnd ? '' : normalizedUrl.slice(queryStart + 1, queryEnd);
  if (new URLSearchParams(`orbit=&${query}`).has('prepare')) {
    throw new Error(
      'Remove the prepare query option from DATABASE_URL and set DATABASE_PREPARED_STATEMENTS instead.',
    );
  }
  const parsed = preparedStatementsSchema.safeParse(configured);
  if (!parsed.success) {
    throw new Error('DATABASE_PREPARED_STATEMENTS must be exactly "true" or "false".');
  }
  return parsed.data === 'true';
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

const prepareStatements = resolvePreparedStatements(
  connectionString,
  process.env['DATABASE_PREPARED_STATEMENTS'],
);
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
