import * as schema from '@orbit/db/schema';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://orbit:orbit@localhost:5434/orbit';

const pool = new Pool({ connectionString, max: 4 });

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
