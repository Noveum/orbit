import { db } from '@orbit/db';
import { TransactionRollbackError } from 'drizzle-orm/errors';

export const testDb = db;

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
