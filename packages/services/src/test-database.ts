import * as schema from '@orbit/db/schema';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const LOCAL_TEST_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_test_svc';

function databaseNameOf(candidate: string): string {
  return new URL(candidate).pathname.replace(/^\//, '');
}

function assertTestDatabase(candidate: string, source: string): string {
  const name = databaseNameOf(candidate);
  if (!name.includes('test')) {
    throw new Error(
      `Refusing to run tests against "${name}" from ${source}. Point it at a database whose name contains "test".`,
    );
  }
  return candidate;
}

function resolveTestDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined) return assertTestDatabase(explicit, 'TEST_DATABASE_URL');
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined) return LOCAL_TEST_DATABASE_URL;
  if (databaseNameOf(ambient).includes('test')) return ambient;
  const url = new URL(ambient);
  url.pathname = '/orbit_test_svc';
  return url.toString();
}

const pool = new Pool({ connectionString: resolveTestDatabaseUrl(), max: 4 });

export const testDb = drizzle(pool, { schema, casing: 'snake_case' });

export type TestTransaction = Parameters<Parameters<typeof testDb.transaction>[0]>[0];

export async function withRollback(run: (tx: TestTransaction) => Promise<void>): Promise<void> {
  try {
    await testDb.transaction(async (tx) => {
      await run(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

export async function closeTestDatabase(): Promise<void> {
  await pool.end();
}
