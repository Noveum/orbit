import * as schema from '@orbit/db/schema';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const LOCAL_TEST_DATABASE_URL = 'postgres://orbit:orbit@localhost:5434/orbit_test_svc';

function resolveTestDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit !== undefined) return explicit;
  const ambient = process.env['DATABASE_URL'];
  if (ambient === undefined) return LOCAL_TEST_DATABASE_URL;
  const name = new URL(ambient).pathname.replace(/^\//, '');
  return name.includes('test') ? ambient : LOCAL_TEST_DATABASE_URL;
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
