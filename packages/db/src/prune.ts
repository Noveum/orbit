import { sql } from 'drizzle-orm';
import type { Database } from './client.ts';

export interface RetentionWindow {
  readonly table: string;
  readonly days: number;
}

export const RETENTION: readonly RetentionWindow[] = [
  { table: 'webhook_delivery', days: 30 },
  { table: 'web_vital', days: 90 },
];

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

export interface PrunedTable {
  readonly table: string;
  readonly days: number;
  readonly deleted: number;
}

export async function pruneOperationalTables(
  database: Database,
  windows: readonly RetentionWindow[] = RETENTION,
): Promise<PrunedTable[]> {
  const pruned: PrunedTable[] = [];

  for (const window of windows) {
    if (!TABLE_NAME.test(window.table)) {
      throw new Error(`${window.table} is not a table name this may delete from.`);
    }
    if (!Number.isInteger(window.days) || window.days < 1) {
      throw new Error(`A retention window must be a whole number of days, not ${window.days}.`);
    }

    const rows = await database.execute<{ deleted: number }>(
      sql`with gone as (
            delete from ${sql.identifier(window.table)}
            where created_at < now() - make_interval(days => ${window.days})
            returning 1
          )
          select count(*)::int as deleted from gone`,
    );

    pruned.push({ table: window.table, days: window.days, deleted: rows[0]?.deleted ?? 0 });
  }

  return pruned;
}
