import { fileURLToPath } from 'node:url';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from './check-drift.ts';
import * as schema from './schema/index.ts';

interface LedgerRow {
  readonly hash: string;
  readonly created_at: string;
}

export interface ReleaseResult {
  readonly mode: 'baselined' | 'migrated' | 'current';
  readonly applied: number;
  readonly total: number;
}

const LOCK_KEY = 4_611_358_438_132_153;

async function ledgerExists(sql: postgres.Sql): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
    ) as exists
  `;
  return row?.exists ?? false;
}

async function ledgerRows(sql: postgres.Sql): Promise<LedgerRow[]> {
  if (!(await ledgerExists(sql))) return [];
  return await sql<LedgerRow[]>`
    select hash, created_at::text as created_at
    from drizzle.__drizzle_migrations
    order by created_at, id
  `;
}

function verifyLedger(rows: readonly LedgerRow[], migrations: readonly MigrationMeta[]): number {
  if (rows.length > migrations.length) {
    throw new Error('The database migration ledger is ahead of this checkout.');
  }
  for (const [index, row] of rows.entries()) {
    const migration = migrations[index];
    if (migration === undefined || row.created_at !== String(migration.folderMillis)) {
      throw new Error('The database migration ledger is not a contiguous prefix of this checkout.');
    }
    if (row.hash !== migration.hash) {
      throw new Error(
        `Migration ${row.created_at} does not match the committed migration. Applied migration files are immutable.`,
      );
    }
  }
  return migrations.length - rows.length;
}

async function baselineLedger(
  sql: postgres.Sql,
  migrations: readonly MigrationMeta[],
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`create schema if not exists drizzle`;
    await tx`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `;
    for (const migration of migrations) {
      await tx`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})
      `;
    }
  });
}

function declaredTableCount(live: Awaited<ReturnType<typeof liveCatalog>>): number {
  const expectedNames = new Set(expectedCatalog(schema).tables.map((table) => table.name));
  return live.tables.filter((table) => expectedNames.has(table.name)).length;
}

export async function releaseDatabase(
  url: string,
  migrationsFolder: string,
): Promise<ReleaseResult> {
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 10 });
  const migrations = readMigrationFiles({ migrationsFolder });
  let locked = false;
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    locked = true;
    await sql`create extension if not exists pg_trgm`;
    const hadLedger = await ledgerExists(sql);
    const existingRows = await ledgerRows(sql);
    const before = await liveCatalog(url);
    let mode: ReleaseResult['mode'] = 'current';

    if ((!hadLedger || existingRows.length === 0) && declaredTableCount(before) > 0) {
      const drift = catalogDriftBetween(expectedCatalog(schema), before);
      if (isBehind(drift)) {
        throw new Error(
          'This legacy database is not compatible with the current schema. Apply the required catchup scripts, verify drift, and run db:release again.',
        );
      }
      await baselineLedger(sql, migrations);
      mode = 'baselined';
    }

    const rows = await ledgerRows(sql);
    const pending = verifyLedger(rows, migrations);
    if (pending > 0) {
      await migrate(drizzle({ client: sql }), { migrationsFolder });
      mode = 'migrated';
    }

    const finalRows = await ledgerRows(sql);
    verifyLedger(finalRows, migrations);
    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(url));
    if (isBehind(drift)) {
      throw new Error(
        'Migrations completed, but the database is still incompatible with the schema.',
      );
    }

    return { mode, applied: pending, total: migrations.length };
  } finally {
    if (locked) {
      await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
    }
    await sql.end({ timeout: 10 });
  }
}

if (import.meta.main) {
  const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    process.stderr.write('Set DIRECT_URL or DATABASE_URL to the target database.\n');
    process.exit(2);
  }
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  const result = await releaseDatabase(url, migrationsFolder);
  process.stdout.write(
    `Database release ${result.mode}. ${result.applied} migration(s) applied, ${result.total} migration(s) recorded.\n`,
  );
}
