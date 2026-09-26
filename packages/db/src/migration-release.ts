import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
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
const AGENT_SCHEMA_MIGRATION = 1_789_829_081_921;
const AGENT_SCHEMA_HASH = 'fad36f4b76c8fd47a5d7efd41b64d71eae7828c162091763c9689353d8f504d3';
const AGENT_BINDING_MIGRATION = 1_789_829_740_142;
const AGENT_BINDING_HASH = '574585419f185dc95fed54d6db3a54309a7ce17ece1b2c33586fb3a67422f3ef';
const HISTORICAL_AGENT_INSTRUCTIONS_MIGRATION = 1_787_562_015_902;
const HISTORICAL_AGENT_INSTRUCTIONS_HASH =
  '53266292651bb8f1368abee0336030f12a780e2086f7d7cbbf49142b4550faeb';
const RECONCILED_LEGACY_DATA_MIGRATIONS = new Set([
  1786217938315, 1786623194883, 1788083189965, 1789829081921, 1789834228668, 1789874131769,
  1789903534025, 1789980471869,
]);

function containsDataChange(migration: MigrationMeta): boolean {
  return migration.sql.some((statement) =>
    /^\s*(?:call|copy|delete|do|insert|merge|truncate|update|with)\b/iu.test(statement),
  );
}

function migrationHashMatches(hash: string, migration: MigrationMeta): boolean {
  if (hash === migration.hash) return true;
  const source = migration.sql.join('--> statement-breakpoint');
  const lineEndingHashes = ['\n', '\r\n'].map((lineEnding) =>
    createHash('sha256').update(source.replace(/\r?\n/gu, lineEnding)).digest('hex'),
  );
  return lineEndingHashes.includes(hash);
}

function isKnownHistoricalAgentInstructionsLedger(
  rows: readonly LedgerRow[],
  migrations: readonly MigrationMeta[],
): boolean {
  if (rows.length !== 14 || migrations.length <= 15) return false;
  for (const [index, row] of rows.slice(0, 13).entries()) {
    const migration = migrations[index];
    if (
      migration === undefined ||
      row.created_at !== String(migration.folderMillis) ||
      !migrationHashMatches(row.hash, migration)
    ) {
      return false;
    }
  }
  const historicalRow = rows[13];
  const currentEquivalent = migrations[15];
  return (
    historicalRow?.created_at === String(HISTORICAL_AGENT_INSTRUCTIONS_MIGRATION) &&
    historicalRow.hash === HISTORICAL_AGENT_INSTRUCTIONS_HASH &&
    currentEquivalent?.sql.length === 1 &&
    currentEquivalent.sql[0]?.trim() ===
      `ALTER TABLE "organization" ADD COLUMN "agent_instructions" text DEFAULT '' NOT NULL;`
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

async function applyPendingMigrations(
  sql: postgres.Sql,
  migrations: readonly MigrationMeta[],
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`create schema if not exists drizzle`;
    await tx`create table if not exists drizzle.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )`;
    for (const migration of migrations) {
      const statements = compatibleMigrationStatements(migration);
      for (const statement of statements) await tx.unsafe(statement);
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})`;
    }
  });
}

function dependencyOrderedAgentBinding(migration: MigrationMeta): readonly string[] {
  if (migration.hash !== AGENT_BINDING_HASH || migration.sql.length !== 2) {
    throw new Error('The historical agent binding migration does not match its recorded source.');
  }
  return [...migration.sql].reverse();
}

function compatibleMigrationStatements(migration: MigrationMeta): readonly string[] {
  if (migration.folderMillis === AGENT_BINDING_MIGRATION) {
    return dependencyOrderedAgentBinding(migration);
  }
  if (migration.folderMillis !== AGENT_SCHEMA_MIGRATION) return migration.sql;
  if (migration.hash !== AGENT_SCHEMA_HASH) {
    throw new Error('The historical agent schema migration does not match its recorded source.');
  }
  const reconcileDeletedPrincipals = ['issue_activity', 'audit_log', 'notification'].map(
    (table) => `update "${table}" record set principal_user_id = null
      where principal_user_id is not null
        and not exists (select 1 from "user" person where person.id = record.principal_user_id)`,
  );
  return migration.sql.flatMap((statement) =>
    statement.trimStart().startsWith('UPDATE "notification"')
      ? [statement, ...reconcileDeletedPrincipals]
      : [statement],
  );
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
    if (!migrationHashMatches(row.hash, migration)) {
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
  replaceExisting = false,
): Promise<void> {
  const pendingMigrations = migrations.slice(appliedCount);
  verifyLegacyDataReconciliation(pendingMigrations);
  await sql.begin(async (tx) => {
    if (replaceExisting) await tx`delete from drizzle.__drizzle_migrations`;
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
    await reconcileAgentData(tx, pendingMigrations);
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

async function reconcileAgentData(
  tx: postgres.TransactionSql,
  migrations: readonly MigrationMeta[],
): Promise<void> {
  const pending = new Set(migrations.map((migration) => migration.folderMillis));
  if (pending.has(1789829081921)) {
    await tx`
      update issue
      set
        creator_user_id = coalesce(creator_user_id, creator_id),
        assignee_user_id = coalesce(assignee_user_id, assignee_id),
        owner_user_id = coalesce(owner_user_id, assignee_id)
    `;
    for (const table of ['issue_activity', 'audit_log', 'notification'] as const) {
      await tx.unsafe(`
        update ${table} record
        set principal_user_id = (
              select existing_user.id from "user" existing_user
              where existing_user.id = record.actor_id
            ),
            principal_name = coalesce(record.principal_name, record.actor_name)
        where record.actor_type = 'user'
          and (record.principal_user_id is null or record.principal_name is null)
      `);
    }
    await tx`
      update mcp_grant
      set principal_name_snapshot = coalesce(existing_user.name, 'Former member')
      from "user" existing_user
      where existing_user.id = mcp_grant.user_id
        and mcp_grant.principal_name_snapshot is null
    `;
    await tx`
      update mcp_grant
      set principal_name_snapshot = 'Former member'
      where principal_name_snapshot is null
    `;
  }
  if (pending.has(1789834228668) || pending.has(1789874131769)) {
    await tx`
      update mcp_grant
      set revoked_at = coalesce(revoked_at, now()), revoke_reason = 'agent_identity_required'
      where agent_identity_id is null
        and revoke_reason is distinct from 'agent_identity_required'
    `;
  }
  if (pending.has(1789874131769)) {
    await tx`
      update mcp_grant grant_row
      set revoked_at = now(), revoke_reason = 'agent_identity_inactive'
      where grant_row.revoked_at is null
        and grant_row.agent_identity_id is not null
        and (
          grant_row.user_id is null
          or not exists (
            select 1
            from agent_identity identity_row
            where identity_row.id = grant_row.agent_identity_id
              and identity_row.organization_id = grant_row.organization_id
              and identity_row.owner_user_id = grant_row.user_id
              and identity_row.client_id = grant_row.client_id
              and identity_row.deleted_at is null
              and identity_row.owner_disabled_at is null
              and identity_row.admin_disabled_at is null
          )
        )
    `;
    await tx`
      delete from oauth_access_token token_row
      where token_row.mcp_grant_id is null
        or not exists (
          select 1
          from mcp_grant grant_row
          where grant_row.id = token_row.mcp_grant_id
            and grant_row.revoked_at is null
            and grant_row.agent_identity_id is not null
        )
    `;
  }
  if (pending.has(1789980471869)) {
    await tx`
      update agent_identity set
        owner_disabled_actor_id_snapshot = coalesce(owner_disabled_actor_id_snapshot, owner_disabled_by_user_id),
        owner_resumed_actor_id_snapshot = coalesce(owner_resumed_actor_id_snapshot, owner_resumed_by_user_id),
        admin_disabled_actor_id_snapshot = coalesce(admin_disabled_actor_id_snapshot, admin_disabled_by_user_id),
        admin_resumed_actor_id_snapshot = coalesce(admin_resumed_actor_id_snapshot, admin_resumed_by_user_id),
        connection_revoked_actor_id_snapshot = coalesce(connection_revoked_actor_id_snapshot, connection_revoked_by_user_id),
        deleted_actor_id_snapshot = coalesce(deleted_actor_id_snapshot, deleted_by_user_id)
    `;
  }
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
    let pending: number;
    try {
      pending = verifyLedger(rows, migrations);
    } catch (error) {
      if (isBehind(beforeDrift) || !isKnownHistoricalAgentInstructionsLedger(rows, migrations)) {
        throw error;
      }
      await baselineLedger(sql, migrations, 0, true);
      mode = 'baselined';
      pending = 0;
    }
    if (pending > 0) {
      if (isBehind(beforeDrift)) {
        await applyPendingMigrations(sql, migrations.slice(rows.length));
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
