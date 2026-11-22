import { expect, it } from 'bun:test';
import { safeErrorFields, withDatabaseLogBoundary } from '@orbit/shared/utils';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { db, sql } from '../src/index.ts';

it('projects a real Postgres conversion failure without its query, driver detail or bound value', async () => {
  const result = await db
    .execute(sql`select ${'SyntheticOpaqueInput'}::uuid`)
    .catch((error: unknown) => error);
  expect(result).toBeInstanceOf(DrizzleQueryError);
  const fields = {
    error: 'Database query failed.',
    errorName: 'DatabaseError',
    errorCode: '22P02',
  };
  expect(safeErrorFields(result)).toEqual(fields);
  const outgoing = await withDatabaseLogBoundary(() => Promise.reject(result)).catch(
    (error: Error) => error,
  );
  expect(safeErrorFields(outgoing)).toEqual(fields);
  expect(outgoing.cause).toBeUndefined();
  expect(JSON.stringify(outgoing)).not.toContain('SyntheticOpaqueInput');
});
