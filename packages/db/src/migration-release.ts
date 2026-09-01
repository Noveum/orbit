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
const RECONCILED_LEGACY_DATA_MIGRATIONS = new Set([
  1786217938315, 1786623194883, 1788083189965, 1788264445370,
]);
const NOTIFICATION_AUDIT_MIGRATION = 1788268141469;
const NOTIFICATION_AUDIT_ARTIFACTS = [
  {
    functionName: 'validate_notification_deduplicated_target',
    triggerName: 'notification_deduplicated_target_trigger',
    tableName: 'notification',
  },
  {
    functionName: 'validate_notification_delivery_deduplicated_target',
    triggerName: 'notification_delivery_deduplicated_target_trigger',
    tableName: 'notification_delivery',
  },
] as const;

function containsDataChange(migration: MigrationMeta): boolean {
  return migration.sql.some((statement) =>
    /^\s*(?:call|copy|delete|do|insert|merge|truncate|update|with)\b/iu.test(statement),
  );
}

function verifyLegacyDataReconciliation(migrations: readonly MigrationMeta[]): void {
  const missing = migrations.filter(
    (migration) =>
      containsDataChange(migration) &&
      !RECONCILED_LEGACY_DATA_MIGRATIONS.has(migration.folderMillis),
  );
  if (missing.length > 0) {
    throw new Error(
      `Legacy baseline has no reconciliation for data migration ${missing[0]?.folderMillis}.`,
    );
  }
}

function artifactStatement(migration: MigrationMeta, prefix: string): string {
  const statements = migration.sql.filter((statement) => statement.trimStart().startsWith(prefix));
  if (statements.length !== 1) {
    throw new Error(`Migration ${migration.folderMillis} has an invalid ${prefix} artifact.`);
  }
  const statement = statements[0];
  if (statement === undefined) {
    throw new Error(`Migration ${migration.folderMillis} has no ${prefix} artifact.`);
  }
  return statement;
}

async function reconcileNotificationAuditArtifacts(
  sql: postgres.TransactionSql,
  migration: MigrationMeta,
): Promise<void> {
  for (const artifact of NOTIFICATION_AUDIT_ARTIFACTS) {
    const functionStatement = artifactStatement(
      migration,
      `CREATE FUNCTION ${artifact.functionName}()`,
    );
    const triggerStatement = artifactStatement(
      migration,
      `CREATE CONSTRAINT TRIGGER ${artifact.triggerName}`,
    );
    await sql.unsafe(functionStatement.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION '));
    await sql.unsafe(`drop trigger if exists "${artifact.triggerName}" on "${artifact.tableName}"`);
    await sql.unsafe(triggerStatement);
  }

  const artifacts = await sql<
    {
      trigger_name: string;
      table_name: string;
      function_name: string;
      valid: boolean;
    }[]
  >`
    select
      trigger.tgname as trigger_name,
      relation.relname as table_name,
      procedure.proname as function_name,
      trigger.tgdeferrable
        and trigger.tginitdeferred
        and trigger.tgenabled = 'O'
        and trigger.tgconstraint <> 0
        and trigger.tgtype = 21 as valid
    from pg_trigger trigger
    inner join pg_class relation on relation.oid = trigger.tgrelid
    inner join pg_namespace relation_namespace on relation_namespace.oid = relation.relnamespace
    inner join pg_proc procedure on procedure.oid = trigger.tgfoid
    inner join pg_namespace procedure_namespace on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and procedure_namespace.nspname = 'public'
      and trigger.tgname in (
        'notification_deduplicated_target_trigger',
        'notification_delivery_deduplicated_target_trigger'
      )
  `;
  const valid = NOTIFICATION_AUDIT_ARTIFACTS.every((expected) =>
    artifacts.some(
      (artifact) =>
        artifact.trigger_name === expected.triggerName &&
        artifact.table_name === expected.tableName &&
        artifact.function_name === expected.functionName &&
        artifact.valid,
    ),
  );
  if (!valid || artifacts.length !== NOTIFICATION_AUDIT_ARTIFACTS.length) {
    throw new Error('Notification audit trigger reconciliation did not produce valid artifacts.');
  }
}

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
  appliedCount = 0,
): Promise<void> {
  const pendingMigrations = migrations.slice(appliedCount);
  verifyLegacyDataReconciliation(pendingMigrations);
  await sql.begin(async (tx) => {
    const notificationAuditMigration = pendingMigrations.find(
      (migration) => migration.folderMillis === NOTIFICATION_AUDIT_MIGRATION,
    );
    if (notificationAuditMigration !== undefined) {
      await reconcileNotificationAuditArtifacts(tx, notificationAuditMigration);
    }
    if (pendingMigrations.some((migration) => migration.folderMillis === 1786217938315)) {
      await tx`
        update attachment
        set upload_expires_at = created_at + interval '900 seconds'
      `;
    }
    if (pendingMigrations.some((migration) => migration.folderMillis === 1786623194883)) {
      const [cycleNumbering] = await tx<{ mismatched: boolean }[]>`
        with expected as (
          select
            id,
            row_number() over (
              partition by organization_id
              order by starts_at, created_at, id
            ) as number
          from cycle
        )
        select exists (
          select 1
          from cycle
          inner join expected on expected.id = cycle.id
          where cycle.number is distinct from expected.number
        ) as mismatched
      `;
      if (cycleNumbering?.mismatched === true) {
        throw new Error(
          'The historical cycle numbering backfill is missing. Apply the required catchup script before baselining.',
        );
      }
    }
    if (pendingMigrations.some((migration) => migration.folderMillis === 1788264445370)) {
      await tx`
        insert into github_check_head_reconciliation (
          id,
          organization_id,
          repository_sync_id,
          head_sha,
          status,
          job_version,
          context_generation,
          trigger_kind,
          trigger_identity,
          attempts,
          available_at,
          rerun_required,
          created_at,
          updated_at
        )
        select
          'ghr_bootstrap_' || md5(organization_id || ':' || repository_sync_id || ':' || head_sha),
          organization_id,
          repository_sync_id,
          head_sha,
          'pending',
          1,
          0,
          'migration_bootstrap',
          '0020_mixed_dust',
          0,
          now(),
          false,
          now(),
          now()
        from (
          select organization_id, repository_sync_id, lower(head_sha) as head_sha
          from github_pull_request
          where state in ('draft', 'open', 'approved', 'changes_requested')
            and merged = false
            and head_sha ~ '^[0-9A-Fa-f]{40}$'
          group by organization_id, repository_sync_id, lower(head_sha)
        ) current_heads
        on conflict (organization_id, repository_sync_id, head_sha) do nothing
      `;
    }
    await tx`create schema if not exists drizzle`;
    await tx`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `;
    for (const migration of pendingMigrations) {
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
    const [lock] = await sql<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(${LOCK_KEY}) as acquired
    `;
    if (lock?.acquired !== true) {
      throw new Error('Another database release is already running. Retry after it finishes.');
    }
    locked = true;
    await sql`create extension if not exists pg_trgm`;
    const hadLedger = await ledgerExists(sql);
    const existingRows = await ledgerRows(sql);
    const before = await liveCatalog(url);
    const beforeDrift = catalogDriftBetween(expectedCatalog(schema), before);
    let mode: ReleaseResult['mode'] = 'current';
    let applied = 0;

    if ((!hadLedger || existingRows.length === 0) && declaredTableCount(before) > 0) {
      if (isBehind(beforeDrift)) {
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
      if (isBehind(beforeDrift)) {
        await migrate(drizzle({ client: sql }), { migrationsFolder });
        applied = pending;
        mode = 'migrated';
      } else {
        await baselineLedger(sql, migrations, rows.length);
        mode = 'baselined';
      }
    }

    const finalRows = await ledgerRows(sql);
    verifyLedger(finalRows, migrations);
    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(url));
    if (isBehind(drift)) {
      throw new Error(
        'Migrations completed, but the database is still incompatible with the schema.',
      );
    }

    return { mode, applied, total: migrations.length };
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
