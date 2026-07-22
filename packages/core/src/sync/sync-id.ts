import { sql } from '@orbit/db';
import { internal } from '@orbit/shared/errors';
import type { Executor } from '../internal.ts';

export async function nextSyncId(executor: Executor): Promise<number> {
  const result = await executor.execute<{ sync_id: string }>(
    sql`select nextval('sync_id_seq') as sync_id`,
  );
  const raw = result.rows[0]?.sync_id;
  if (raw === undefined) throw internal('Could not allocate a sync id.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw internal('Allocated sync id is out of range.');
  return value;
}
