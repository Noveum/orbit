import { fileURLToPath } from 'node:url';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from '@orbit/db/check-drift';
import * as schema from '@orbit/db/schema';
import { internal, validationFailed } from '@orbit/shared';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

export interface PreflightCheckResult {
  readonly databaseVersion: string;
  readonly ledger: readonly { readonly hash: string; readonly createdAt: string }[];
}

export async function verifyPreflight(
  url: string,
  customMigrationsFolder?: string,
): Promise<PreflightCheckResult> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 10,
    prepare: false,
  });
  try {
    const [versionRow] = await sql<{ version: string }[]>`select version() as version`;
    if (versionRow === undefined) {
      throw internal('Unable to determine PostgreSQL version.');
    }

    const [tableExistsRow] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
      ) as exists
    `;
    if (tableExistsRow?.exists !== true) {
      throw validationFailed(
        'Migration ledger table "drizzle.__drizzle_migrations" does not exist.',
      );
    }

    const rows = await sql<{ hash: string; created_at: string }[]>`
      select hash, created_at::text as created_at
      from drizzle.__drizzle_migrations
      order by created_at, id
    `;
    if (rows.length === 0) {
      throw validationFailed(
        'Migration ledger is empty. Apply database migrations before backing up.',
      );
    }

    const migrationsFolder =
      customMigrationsFolder ?? fileURLToPath(new URL('../../../db/drizzle', import.meta.url));
    const committedMigrations = readMigrationFiles({ migrationsFolder });

    if (rows.length > committedMigrations.length) {
      throw validationFailed('Database migration ledger is ahead of this application release.');
    }

    for (const [index, row] of rows.entries()) {
      const committed = committedMigrations[index];
      if (committed === undefined || row.created_at !== String(committed.folderMillis)) {
        throw validationFailed(
          'Database migration ledger is not a contiguous prefix of committed migrations.',
        );
      }
      if (row.hash !== committed.hash) {
        throw validationFailed(
          `Migration ${row.created_at} hash does not match committed migration file.`,
        );
      }
    }

    if (rows.length < committedMigrations.length) {
      throw validationFailed(
        `Database is missing ${committedMigrations.length - rows.length} pending migration(s). Run db:release before backing up.`,
      );
    }

    const live = await liveCatalog(url);
    const drift = catalogDriftBetween(expectedCatalog(schema), live);
    if (isBehind(drift)) {
      throw validationFailed(
        'Database schema has unapplied or incompatible drift relative to application schema.',
      );
    }

    return {
      databaseVersion: versionRow.version,
      ledger: rows.map((r) => ({ hash: r.hash, createdAt: r.created_at })),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
