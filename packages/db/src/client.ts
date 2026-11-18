import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import { privateDatabaseProxyUrl } from './private-proxy.ts';
import * as schema from './schema/index.ts';
import { resolveDatabaseTls } from './tls-policy.ts';

function requiredConnectionString(): string {
  const configured = process.env['DATABASE_URL'];
  if (configured === undefined || configured.length === 0) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and run bun run infra:up.');
  }
  return configured;
}

const connectionString = requiredConnectionString();

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

const maxConnections = poolMax.data;

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

export function poolCacheKey(
  url: string,
  max: number,
  prepare: boolean,
  tls?: ReturnType<typeof resolveDatabaseTls>,
): string {
  return JSON.stringify([url, max, prepare, tls]);
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
const ssl = resolveDatabaseTls(connectionString, process.env);
const cacheKey = poolCacheKey(connectionString, maxConnections, prepareStatements, ssl);
const cached = globalForDb.orbitPool;

const PROCESS_IDLE_SECONDS = 30;
const SCOPED_IDLE_SECONDS = 5;

function openPool(idleSeconds: number = PROCESS_IDLE_SECONDS): Pool {
  return postgres(connectionString, {
    max: maxConnections,
    idle_timeout: idleSeconds,
    prepare: prepareStatements,
    ...(ssl === undefined ? {} : { ssl }),
  });
}

function openScopedPool(): Pool {
  const privateProxyUrl = privateDatabaseProxyUrl();
  if (privateProxyUrl === undefined) {
    return postgres(connectionString, {
      max: maxConnections,
      idle_timeout: SCOPED_IDLE_SECONDS,
      prepare: prepareStatements,
      fetch_types: false,
      ...(ssl === undefined ? {} : { ssl }),
    });
  }
  return postgres(privateProxyUrl, {
    max: maxConnections,
    idle_timeout: SCOPED_IDLE_SECONDS,
    prepare: true,
    fetch_types: false,
  });
}

function openDatabase(client: Pool) {
  return drizzle({ client, schema, casing: 'snake_case' });
}

export const pool = cached?.key === cacheKey ? cached.sql : openPool();

globalForDb.orbitPool = { key: cacheKey, sql: pool };

const processDatabase = openDatabase(pool);

export type Database = typeof processDatabase;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

interface RequestDatabaseScope {
  database: Database | undefined;
}

const requestScopes = new AsyncLocalStorage<RequestDatabaseScope>();

function currentDatabase(): Database {
  const scope = requestScopes.getStore();
  if (scope === undefined) return processDatabase;
  scope.database ??= openDatabase(openScopedPool());
  return scope.database;
}

export type DatabaseScope = <T>(run: () => T) => T;

export function createDatabaseScope(): DatabaseScope {
  const scope: RequestDatabaseScope = { database: undefined };
  return (run) => requestScopes.run(scope, run);
}

export function withRequestScopedDatabase<T>(run: () => T): T {
  return createDatabaseScope()(run);
}

export const db: Database = new Proxy(processDatabase, {
  get(_process, property) {
    const database = currentDatabase();
    if (property === '$client') return database.$client;
    const value: unknown = Reflect.get(database, property, database);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

export {
  type PrivateProxyUrlResolver,
  privateDatabaseProxyUrl,
  registerPrivateDatabaseProxy,
} from './private-proxy.ts';
