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

    const eligible =
      window.table === 'webhook_delivery'
        ? sql`
            created_at < now() - make_interval(days => ${window.days})
            and status <> 'quarantined'
            and not exists (
              select 1
              from webhook_delivery_quarantine
              where webhook_delivery_quarantine.delivery_id = webhook_delivery.id
            )
            and not exists (
              select 1
              from github_check_activity
              where github_check_activity.webhook_delivery_id = webhook_delivery.id
                and github_check_activity.organization_id = webhook_delivery.organization_id
            )
          `
        : sql`created_at < now() - make_interval(days => ${window.days})`;
    const rows = await database.execute<{ deleted: number }>(sql`
      with gone as (
        delete from ${sql.identifier(window.table)}
        where ${eligible}
        returning 1
      )
      select count(*)::int as deleted from gone
    `);

    pruned.push({ table: window.table, days: window.days, deleted: rows[0]?.deleted ?? 0 });
  }

  return pruned;
}
