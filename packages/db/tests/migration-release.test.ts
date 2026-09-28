import { afterAll, describe, expect, it } from 'bun:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { z } from 'zod';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
import { applyCatchup } from '../src/apply-catchup.ts';
import { releaseDatabase } from '../src/migration-release.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_migration_release', currentLane());
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const MIGRATION_ENTRIES = readMigrationFiles({ migrationsFolder: MIGRATIONS });
const AGENT_SCHEMA_MIGRATION = MIGRATION_ENTRIES.at(-1)?.folderMillis;
const UPSTREAM_MIGRATION_COUNT = MIGRATION_ENTRIES.length - 1;

if (AGENT_SCHEMA_MIGRATION === undefined) {
  throw new Error('The final Agent schema migration is missing.');
}

function urlFor(database: string): string {
  const url = new URL(BASE);
  url.pathname = `/${database}`;
  return url.toString();
}

async function run<T>(url: string, work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

async function resetScratch(): Promise<void> {
  await run(urlFor('postgres'), async (sql) => {
    await sql.unsafe(`drop database if exists "${SCRATCH}"`);
    await sql.unsafe(`create database "${SCRATCH}"`);
  });
  await run(urlFor(SCRATCH), (sql) => sql`create extension if not exists pg_trgm`);
}

async function migrateScratch(): Promise<void> {
  await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
}

async function migrationPrefixDirectory(throughTag: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-p3-migration-prefix-'));
  const metaDirectory = join(MIGRATIONS, 'meta');
  const journal = JSON.parse(await readFile(join(metaDirectory, '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const entries = journal.entries.filter((entry) => entry.tag <= throughTag);
  await cp(metaDirectory, join(directory, 'meta'), { recursive: true });
  await writeFile(
    join(directory, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }),
  );
  await Promise.all(
    entries.map(async ({ tag }) => {
      await cp(join(MIGRATIONS, `${tag}.sql`), join(directory, `${tag}.sql`));
    }),
  );
  return directory;
}

const migrationJournalEntrySchema = z.object({
  idx: z.number().int().nonnegative(),
  version: z.string().min(1),
  when: z.number().int().positive(),
  tag: z.string().min(1),
  breakpoints: z.boolean(),
});

const migrationJournalSchema = z.object({
  version: z.string().min(1),
  dialect: z.string().min(1),
  entries: z.array(migrationJournalEntrySchema).min(1),
});

async function migrationsFolderWithTrailer(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'orbit-release-'));
  await cp(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = migrationJournalSchema.parse(JSON.parse(await readFile(journalPath, 'utf8')));
  const last = journal.entries.at(-1);
  if (last === undefined) throw new Error('the migration journal has no entries to build on');
  const tag = '9999_release_reconcile_probe';
  journal.entries.push({
    idx: last.idx + 1,
    version: last.version,
    when: last.when + 1,
    tag,
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(join(folder, `${tag}.sql`), 'SELECT 1;\n');
  return folder;
}

describe('database release', () => {
  it('retries Agent migration finalization from the official upstream ledger', async () => {
    await resetScratch();
    const historical = MIGRATION_ENTRIES.slice(0, UPSTREAM_MIGRATION_COUNT);
    await run(urlFor(SCRATCH), async (sql) => {
      await sql.begin(async (tx) => {
        await tx`create schema drizzle`;
        await tx`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
        for (const migration of historical) {
          for (const statement of migration.sql) await tx.unsafe(statement);
          await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
        }
      });
      await sql`insert into "user" (id, name, email, handle) values ('upgrade-owner', 'Owner', 'upgrade@example.com', 'upgrade-owner')`;
      await sql`insert into organization (id, name, slug) values ('upgrade-org', 'Org', 'upgrade-org')`;
      await sql`insert into oauth_application (id, client_id, name, redirect_urls, type) values ('upgrade-client', 'upgrade-client', 'Client', 'https://example.com', 'web')`;
      await sql`insert into mcp_grant (id, client_id, user_id, organization_id, scopes) values ('upgrade-grant', 'upgrade-client', 'upgrade-owner', 'upgrade-org', 'orbit.read')`;
      await sql`insert into oauth_consent (id, client_id, user_id, scopes, consent_given) values ('upgrade-consent', 'upgrade-client', 'upgrade-owner', 'orbit.read', true)`;
      await sql`insert into oauth_access_token (id, client_id, user_id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, scopes) values ('upgrade-token', 'upgrade-client', 'upgrade-owner', 'upgrade-access', 'upgrade-refresh', now(), now(), 'orbit.read')`;
      await sql`create function reject_upgrade() returns trigger as $$ begin raise exception 'upgrade interrupted'; end; $$ language plpgsql`;
      await sql`create trigger reject_upgrade_trigger before update on mcp_grant for each row execute function reject_upgrade()`;
    });
    const originalLedger = await run(
      urlFor(SCRATCH),
      (sql) => sql`select * from drizzle.__drizzle_migrations order by id`,
    );
    const originalConsent = await run(urlFor(SCRATCH), (sql) => sql`select * from oauth_consent`);
    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      'upgrade interrupted',
    );
    expect([
      ...(await run(
        urlFor(SCRATCH),
        (sql) => sql`select * from drizzle.__drizzle_migrations order by id`,
      )),
    ]).toEqual([...originalLedger]);
    expect(
      await run(urlFor(SCRATCH), (sql) => sql`select id from oauth_access_token`),
    ).toHaveLength(1);
    expect(
      await run(
        urlFor(SCRATCH),
        (sql) =>
          sql`select id from drizzle.__drizzle_migration_state where migration_id = ${AGENT_SCHEMA_MIGRATION}`,
      ),
    ).toHaveLength(1);
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`drop trigger reject_upgrade_trigger on mcp_grant`;
      await sql`drop function reject_upgrade()`;
    });
    expect((await releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).applied).toBe(1);
    expect([
      ...(await run(
        urlFor(SCRATCH),
        (sql) =>
          sql`select * from drizzle.__drizzle_migrations order by id limit ${UPSTREAM_MIGRATION_COUNT}`,
      )),
    ]).toEqual([...originalLedger]);
    expect([...(await run(urlFor(SCRATCH), (sql) => sql`select * from oauth_consent`))]).toEqual([
      ...originalConsent,
    ]);
    expect(
      await run(urlFor(SCRATCH), (sql) => sql`select id from oauth_access_token`),
    ).toHaveLength(0);
    expect(
      (await run(urlFor(SCRATCH), (sql) => sql`select revoke_reason from mcp_grant`))[0]?.[
        'revoke_reason'
      ],
    ).toBe('agent_identity_required');
    expect((await releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).mode).toBe('current');
  }, 60_000);

  it('commits Agent backfill batches and resumes after an interrupted batch', async () => {
    await resetScratch();
    const prefixDirectory = await migrationPrefixDirectory('0029_material_psynapse');
    try {
      await expect(releaseDatabase(urlFor(SCRATCH), prefixDirectory)).rejects.toThrow(
        'Migrations completed, but the database is still incompatible with the schema.',
      );
      await run(urlFor(SCRATCH), async (sql) => {
        await sql`insert into "user" (id, name, email, handle)
          values ('batch-owner', 'Batch owner', 'batch@example.com', 'batch-owner')`;
        await sql`insert into organization (id, name, slug)
          values ('batch-org', 'Batch org', 'batch-org')`;
        await sql`insert into team (id, organization_id, name, key)
          values ('batch-team', 'batch-org', 'Batch team', 'BAT')`;
        await sql`insert into workflow_state (id, organization_id, team_id, name, category, color)
          values ('batch-state', 'batch-org', 'batch-team', 'Todo', 'unstarted', '#000')`;
        await sql`insert into issue (
          id, organization_id, team_id, number, identifier, title, state_id, creator_id, assignee_id
        )
        select
          'batch-issue-' || lpad(number::text, 4, '0'),
          'batch-org', 'batch-team', number, 'BAT-' || number::text, 'Batch issue',
          'batch-state', 'batch-owner', 'batch-owner'
        from generate_series(1, 1005) as generated(number)`;
        await sql`create function reject_second_agent_schema_batch() returns trigger as $$
          begin
            if new.id = 'batch-issue-1001' then raise exception 'agent batch interrupted'; end if;
            return new;
          end;
        $$ language plpgsql`;
        await sql`create trigger reject_second_agent_schema_batch_trigger
          before update on issue for each row execute function reject_second_agent_schema_batch()`;
      });

      await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
        'agent batch interrupted',
      );
      const [afterFailure] = await run(
        urlFor(SCRATCH),
        (sql) => sql<{ backfilled: number; migration_rows: number; pending_markers: number }[]>`
          select
            (select count(*)::integer from issue where creator_user_id is not null) as backfilled,
            (select count(*)::integer from drizzle.__drizzle_migrations where created_at = ${AGENT_SCHEMA_MIGRATION}) as migration_rows,
            (select count(*)::integer from drizzle.__drizzle_migration_state where migration_id = ${AGENT_SCHEMA_MIGRATION}) as pending_markers
        `,
      );
      expect(afterFailure).toEqual({ backfilled: 1000, migration_rows: 0, pending_markers: 1 });

      await run(urlFor(SCRATCH), async (sql) => {
        await sql`drop trigger reject_second_agent_schema_batch_trigger on issue`;
        await sql`drop function reject_second_agent_schema_batch()`;
      });
      const retried = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
      const [afterRetry] = await run(
        urlFor(SCRATCH),
        (sql) => sql<
          {
            backfilled: number;
            complete: number;
            migration_rows: number;
            pending_markers: number;
          }[]
        >`
          select
            (select count(*)::integer from issue where creator_user_id is not null) as backfilled,
            (select count(*)::integer from issue where creator_user_id = 'batch-owner'
              and assignee_user_id = 'batch-owner' and owner_user_id = 'batch-owner') as complete,
            (select count(*)::integer from drizzle.__drizzle_migrations where created_at = ${AGENT_SCHEMA_MIGRATION}) as migration_rows,
            (select count(*)::integer from drizzle.__drizzle_migration_state where migration_id = ${AGENT_SCHEMA_MIGRATION}) as pending_markers
        `,
      );
      expect(retried.mode).toBe('migrated');
      expect(afterRetry).toEqual({
        backfilled: 1005,
        complete: 1005,
        migration_rows: 1,
        pending_markers: 0,
      });
    } finally {
      await rm(prefixDirectory, { recursive: true });
    }
  }, 120_000);

  it('rolls back Agent schema preparation DDL when an object already exists', async () => {
    const target = `${SCRATCH}_p3_interrupt`;
    const prefixDirectory = await migrationPrefixDirectory('0029_material_psynapse');
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${target}"`);
      await sql.unsafe(`create database "${target}"`);
    });
    try {
      await expect(releaseDatabase(urlFor(target), prefixDirectory)).rejects.toThrow(
        'Migrations completed, but the database is still incompatible with the schema.',
      );
      await run(
        urlFor(target),
        (sql) => sql`create table public.mcp_idempotency (id text primary key)`,
      );

      await expect(releaseDatabase(urlFor(target), MIGRATIONS)).rejects.toThrow();
      const [afterFailure] = await run(
        urlFor(target),
        (sql) => sql<{ outbox: string | null; ledger_count: number }[]>`
          select
            to_regclass('public.issue_outbox')::text as outbox,
            (select count(*)::integer from drizzle.__drizzle_migrations) as ledger_count
        `,
      );
      expect(afterFailure).toEqual({ outbox: null, ledger_count: UPSTREAM_MIGRATION_COUNT });

      await run(urlFor(target), (sql) => sql`drop table public.mcp_idempotency`);
      const retried = await releaseDatabase(urlFor(target), MIGRATIONS);
      expect(retried.mode).toBe('migrated');
      expect(retried.applied).toBe(1);
      const [afterRetry] = await run(
        urlFor(target),
        (sql) => sql<{ outbox: string | null; ledger_count: number }[]>`
          select
            to_regclass('public.issue_outbox')::text as outbox,
            (select count(*)::integer from drizzle.__drizzle_migrations) as ledger_count
        `,
      );
      expect(afterRetry).toEqual({
        outbox: 'issue_outbox',
        ledger_count: MIGRATION_ENTRIES.length,
      });
    } finally {
      await Promise.all([
        run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${target}"`)),
        rm(prefixDirectory, { recursive: true }),
      ]);
    }
  }, 120_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('upgrades the released main ledger before applying notification migrations', async () => {
    await resetScratch();
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const released = migrations.filter((migration) => migration.folderMillis <= 1788724695585);
    expect(released).toHaveLength(18);
    await run(urlFor(SCRATCH), async (sql) => {
      for (const migration of released) {
        for (const statement of migration.sql) await sql.unsafe(statement);
      }
      await sql`create schema drizzle`;
      await sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      for (const migration of released) {
        await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
      await sql`insert into organization (id, name, slug) values ('upgrade-org', 'Upgrade', 'upgrade-org')`;
      await sql`insert into project (id, organization_id, name, slug, health) values ('upgrade-project', 'upgrade-org', 'Preserved', 'preserved', 'at_risk')`;
    });
    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    expect(result.mode).toBe('migrated');
    expect(result.applied).toBe(migrations.length - released.length);
    await run(urlFor(SCRATCH), async (sql) => {
      const [project] = await sql`select health from project where id = 'upgrade-project'`;
      expect(project?.['health']).toBe('at_risk');
      const constraints =
        await sql`select conname from pg_constraint where conname in ('project_health_check', 'project_update_health_check', 'webhook_delivery_processing_claim_check') order by conname`;
      expect(constraints.map((row) => row['conname'])).toEqual([
        'project_health_check',
        'project_update_health_check',
        'webhook_delivery_processing_claim_check',
      ]);
      const ledger = await sql`select hash from drizzle.__drizzle_migrations order by created_at`;
      expect(ledger.map((row) => row['hash'])).toEqual(
        migrations.map((migration) => migration.hash),
      );
    });
  }, 60_000);

  it('baselines a compatible legacy database without touching undeclared data', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create table legacy_github_mirror (id text primary key, payload text not null)`;
      await sql`insert into legacy_github_mirror (id, payload) values ('pr-1', 'preserve me')`;
      await sql`drop schema drizzle cascade`;
    });

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const ledger = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ hash: string; created_at: string }[]>`
        select hash, created_at from drizzle.__drizzle_migrations order by created_at
      `,
    );
    const preserved = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ payload: string }[]>`select payload from legacy_github_mirror`,
    );

    expect(result.mode).toBe('baselined');
    expect([...ledger]).toEqual(
      migrations.map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
    );
    expect([...preserved]).toEqual([{ payload: 'preserve me' }]);
  }, 60_000);

  it('does not silently baseline a missing webhook ownership constraint', async () => {
    await resetScratch();
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const constraintIndex = migrations.findIndex((migration) =>
      migration.sql.some((statement) =>
        statement.includes('ADD CONSTRAINT "webhook_delivery_processing_claim_check"'),
      ),
    );
    expect(constraintIndex).toBeGreaterThan(0);
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create schema drizzle`;
      await sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      for (const migration of migrations.slice(0, constraintIndex)) {
        for (const statement of migration.sql) await sql.unsafe(statement);
        await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
    });
    await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const rows = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql`select convalidated from pg_constraint where conname = 'webhook_delivery_processing_claim_check'`,
    );
    expect([...rows]).toEqual([{ convalidated: true }]);
  }, 60_000);

  it('reconciles objects owned by already-applied migrations when a later migration is pending', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`alter table webhook_delivery drop constraint webhook_delivery_processing_claim_check`;
      await sql`drop trigger notification_deduplicated_target_trigger on notification`;
      await sql`drop function validate_notification_deduplicated_target()`;
      await sql`drop trigger notification_delivery_deduplicated_target_trigger on notification_delivery`;
      await sql`drop function validate_notification_delivery_deduplicated_target()`;
    });

    const folder = await migrationsFolderWithTrailer();
    let mode: string;
    try {
      const result = await releaseDatabase(urlFor(SCRATCH), folder);
      mode = result.mode;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }

    const constraint = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql`select convalidated from pg_constraint where conname = 'webhook_delivery_processing_claim_check'`,
    );
    const triggers = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ trigger_name: string; valid: boolean }[]>`
        select
          trigger.tgname as trigger_name,
          trigger.tgdeferrable
            and trigger.tginitdeferred
            and trigger.tgenabled = 'O'
            and trigger.tgconstraint <> 0 as valid
        from pg_trigger trigger
        inner join pg_class relation on relation.oid = trigger.tgrelid
        inner join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and trigger.tgname in (
            'notification_deduplicated_target_trigger',
            'notification_delivery_deduplicated_target_trigger'
          )
        order by trigger.tgname
      `,
    );

    expect(mode).toBe('baselined');
    expect([...constraint]).toEqual([{ convalidated: true }]);
    expect([...triggers]).toEqual([
      { trigger_name: 'notification_deduplicated_target_trigger', valid: true },
      { trigger_name: 'notification_delivery_deduplicated_target_trigger', valid: true },
    ]);
  }, 60_000);

  it('runs a pending migration that only adds a check instead of baselining it away', async () => {
    await resetScratch();
    await migrateScratch();
    const source = await readFile(join(MIGRATIONS, '0021_mixed_dust.sql'), 'utf8');
    const statement = source
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .find((part) => part.includes('ADD CONSTRAINT "github_pull_request_head_epoch_check"'));
    expect(statement).toBeDefined();

    await run(urlFor(SCRATCH), async (sql) => {
      await sql`alter table github_pull_request drop constraint github_pull_request_head_epoch_check`;
    });

    const folder = await mkdtemp(join(tmpdir(), 'orbit-release-pending-check-'));
    await cp(MIGRATIONS, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = migrationJournalSchema.parse(JSON.parse(await readFile(journalPath, 'utf8')));
    const last = journal.entries.at(-1);
    if (last === undefined) throw new Error('the migration journal has no entries to build on');
    const tag = '9999_release_pending_check_probe';
    journal.entries.push({
      idx: last.idx + 1,
      version: last.version,
      when: last.when + 1,
      tag,
      breakpoints: true,
    });
    await writeFile(journalPath, JSON.stringify(journal, null, 2));
    await writeFile(join(folder, `${tag}.sql`), `${statement ?? ''}\n`);

    let mode = '';
    try {
      mode = (await releaseDatabase(urlFor(SCRATCH), folder)).mode;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }

    expect(mode).toBe('migrated');
    const constraint = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql`select convalidated from pg_constraint where conname = 'github_pull_request_head_epoch_check'`,
    );
    expect([...constraint]).toEqual([{ convalidated: true }]);
  }, 60_000);

  it('does not route a same-named check on another table to the migration path', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`alter table github_pull_request drop constraint github_pull_request_head_epoch_check`;
    });

    const folder = await mkdtemp(join(tmpdir(), 'orbit-release-stray-check-'));
    await cp(MIGRATIONS, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = migrationJournalSchema.parse(JSON.parse(await readFile(journalPath, 'utf8')));
    const last = journal.entries.at(-1);
    if (last === undefined) throw new Error('the migration journal has no entries to build on');
    const tag = '9999_release_stray_check_probe';
    journal.entries.push({
      idx: last.idx + 1,
      version: last.version,
      when: last.when + 1,
      tag,
      breakpoints: true,
    });
    await writeFile(journalPath, JSON.stringify(journal, null, 2));
    await writeFile(
      join(folder, `${tag}.sql`),
      'ALTER TABLE "notification" ADD CONSTRAINT "github_pull_request_head_epoch_check" CHECK (true);\n',
    );

    try {
      await expect(releaseDatabase(urlFor(SCRATCH), folder)).rejects.toThrow('still incompatible');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }

    const stray = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql`select count(*)::int as count from pg_constraint where conname = 'github_pull_request_head_epoch_check' and conrelid = 'notification'::regclass`,
    );
    expect([...stray]).toEqual([{ count: 0 }]);
  }, 60_000);

  it('restores deferred audit triggers while baselining a schema-pushed catalog', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`drop trigger notification_deduplicated_target_trigger on notification`;
      await sql`drop function validate_notification_deduplicated_target()`;
      await sql`drop trigger notification_delivery_deduplicated_target_trigger on notification_delivery`;
      await sql`drop function validate_notification_delivery_deduplicated_target()`;
      await sql`drop schema drizzle cascade`;
    });

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const triggers = await run(
      urlFor(SCRATCH),
      (sql) => sql<
        {
          trigger_name: string;
          table_name: string;
          function_name: string;
          deferrable: boolean;
          initially_deferred: boolean;
          enabled: string;
          constraint_trigger: boolean;
        }[]
      >`
        select
          trigger.tgname as trigger_name,
          relation.relname as table_name,
          procedure.proname as function_name,
          trigger.tgdeferrable as deferrable,
          trigger.tginitdeferred as initially_deferred,
          trigger.tgenabled as enabled,
          trigger.tgconstraint <> 0 as constraint_trigger
        from pg_trigger trigger
        inner join pg_class relation on relation.oid = trigger.tgrelid
        inner join pg_namespace namespace on namespace.oid = relation.relnamespace
        inner join pg_proc procedure on procedure.oid = trigger.tgfoid
        where namespace.nspname = 'public'
          and trigger.tgname in (
            'notification_deduplicated_target_trigger',
            'notification_delivery_deduplicated_target_trigger'
          )
        order by trigger.tgname
      `,
    );

    expect(result.mode).toBe('baselined');
    expect([...triggers]).toEqual([
      {
        trigger_name: 'notification_deduplicated_target_trigger',
        table_name: 'notification',
        function_name: 'validate_notification_deduplicated_target',
        deferrable: true,
        initially_deferred: true,
        enabled: 'O',
        constraint_trigger: true,
      },
      {
        trigger_name: 'notification_delivery_deduplicated_target_trigger',
        table_name: 'notification_delivery',
        function_name: 'validate_notification_delivery_deduplicated_target',
        deferrable: true,
        initially_deferred: true,
        enabled: 'O',
        constraint_trigger: true,
      },
    ]);
  }, 60_000);

  it('reconciles historical data backfills before baselining a legacy database', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into "user" (id, name, email, handle)
        values ('release-user', 'Release user', 'release@example.com', 'release-user')
      `;
      await sql`
        insert into organization (id, name, slug)
        values ('release-org', 'Release org', 'release-org')
      `;
      await sql`
        insert into attachment (
          id, organization_id, parent_type, parent_id, file_name, content_type,
          size, storage_key, uploaded_by_id, created_at, upload_expires_at
        ) values (
          'release-attachment', 'release-org', 'issue', 'issue-1', 'proof.txt',
          'text/plain', 1, 'release/proof.txt', 'release-user',
          '2026-08-14T00:00:00Z', '2027-01-01T00:00:00Z'
        )
      `;
      await sql`drop schema drizzle cascade`;
    });

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const [attachment] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ upload_expires_at: string | null }[]>`
        select upload_expires_at::text as upload_expires_at
        from attachment
        where id = 'release-attachment'
      `,
    );

    expect(result.mode).toBe('baselined');
    expect(attachment?.upload_expires_at).toBe('2026-08-14 00:15:00+00');
  }, 60_000);

  it('queues current pull request heads while baselining a catalog-complete database', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into "user" (id, name, email, handle)
        values ('release-github-user', 'Release GitHub user', 'release-github@example.com', 'release-github')
      `;
      await sql`
        insert into organization (id, name, slug)
        values ('release-github-org', 'Release GitHub org', 'release-github-org')
      `;
      await sql`
        insert into integration (id, organization_id, provider, external_id, connected_by_id)
        values (
          'release-github-integration', 'release-github-org', 'github',
          'release-github-installation', 'release-github-user'
        )
      `;
      await sql`
        insert into github_repository_sync (
          id, organization_id, integration_id, repository_id, repository_name, installation_id
        ) values (
          'release-github-repository', 'release-github-org', 'release-github-integration',
          '99', 'acme/web', 'release-github-installation'
        )
      `;
      await sql`
        insert into github_pull_request (
          id, organization_id, repository_sync_id, repository_id, repository_name,
          number, url, head_sha, state, merged
        ) values
          (
            'release-github-pull-open', 'release-github-org', 'release-github-repository',
            '99', 'acme/web', 1, 'https://github.com/acme/web/pull/1',
            '0123456789abcdef0123456789abcdef01234567', 'open', false
          ),
          (
            'release-github-pull-draft', 'release-github-org', 'release-github-repository',
            '99', 'acme/web', 2, 'https://github.com/acme/web/pull/2',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'draft', false
          ),
          (
            'release-github-pull-approved', 'release-github-org', 'release-github-repository',
            '99', 'acme/web', 3, 'https://github.com/acme/web/pull/3',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'approved', false
          ),
          (
            'release-github-pull-changes', 'release-github-org', 'release-github-repository',
            '99', 'acme/web', 4, 'https://github.com/acme/web/pull/4',
            'cccccccccccccccccccccccccccccccccccccccc', 'changes_requested', false
          ),
          (
            'release-github-pull-closed', 'release-github-org', 'release-github-repository',
            '99', 'acme/web', 5, 'https://github.com/acme/web/pull/5',
            'dddddddddddddddddddddddddddddddddddddddd', 'closed', false
          )
      `;
      await sql`drop schema drizzle cascade`;
    });

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const jobs = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ head_sha: string; status: string; trigger_kind: string; attempts: number }[]>`
        select head_sha, status, trigger_kind, attempts
        from github_check_head_reconciliation
        where organization_id = 'release-github-org'
        order by head_sha
      `,
    );

    expect(result.mode).toBe('baselined');
    expect([...jobs]).toEqual([
      {
        head_sha: '0123456789abcdef0123456789abcdef01234567',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
      {
        head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
      {
        head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
      {
        head_sha: 'cccccccccccccccccccccccccccccccccccccccc',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
    ]);
  }, 60_000);

  it('refuses to baseline when a historical data invariant cannot be reconciled safely', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into organization (id, name, slug)
        values ('numbering-org', 'Numbering org', 'numbering-org')
      `;
      await sql`
        insert into cycle (
          id, organization_id, number, starts_at, ends_at, created_at
        ) values
          (
            'later-cycle', 'numbering-org', 10, '2026-08-15T00:00:00Z',
            '2026-08-22T00:00:00Z', '2026-08-10T00:00:00Z'
          ),
          (
            'earlier-cycle', 'numbering-org', 20, '2026-08-01T00:00:00Z',
            '2026-08-08T00:00:00Z', '2026-07-28T00:00:00Z'
          )
      `;
      await sql`drop schema drizzle cascade`;
    });

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      'historical cycle numbering backfill',
    );
    await applyCatchup(urlFor(SCRATCH), 'cycle-numbering-baseline.sql');
    expect((await releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).mode).toBe('baselined');
    const cycles = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ id: string; number: number }[]>`
        select id, number from cycle where organization_id = 'numbering-org' order by number
      `,
    );
    expect([...cycles]).toEqual([
      { id: 'earlier-cycle', number: 1 },
      { id: 'later-cycle', number: 2 },
    ]);
  }, 60_000);

  it('rejects a changed hash in an applied migration', async () => {
    await resetScratch();
    await migrateScratch();
    await run(
      urlFor(SCRATCH),
      (sql) => sql`
      update drizzle.__drizzle_migrations
      set hash = 'changed-after-application'
      where created_at = (select max(created_at) from drizzle.__drizzle_migrations)
    `,
    );

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      'does not match the committed migration',
    );
  }, 60_000);

  it('rejects an unpublished #215 ledger without repairing it', async () => {
    await resetScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create schema drizzle`;
      await sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      await sql`insert into drizzle.__drizzle_migrations (hash, created_at)
        values ('unpublished-feature-migration', 1790178834499)`;
    });
    const originalLedger = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at, id`,
    );

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      'not a contiguous prefix',
    );
    expect([
      ...(await run(
        urlFor(SCRATCH),
        (sql) =>
          sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at, id`,
      )),
    ]).toEqual([...originalLedger]);
  }, 60_000);

  it('fails promptly when another database release holds the advisory lock', async () => {
    await resetScratch();
    const lockKey = 4_611_358_438_132_153;
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`select pg_advisory_lock(${lockKey})`;
      try {
        await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
          'Another database release is already running',
        );
      } finally {
        await sql`select pg_advisory_unlock(${lockKey})`;
      }
    });
  }, 60_000);

  it('refuses to baseline a partial legacy schema', async () => {
    await resetScratch();
    await run(
      urlFor(SCRATCH),
      (sql) => sql`
      create table organization (id text primary key, name text not null)
    `,
    );

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      'Apply the required catchup scripts',
    );
    const [ledger] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
        ) as exists
      `,
    );
    expect(ledger?.exists).toBe(false);
  }, 60_000);

  it('migrates an empty database and is idempotent', async () => {
    await resetScratch();

    const first = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const second = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const [issue] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ exists: boolean }[]>`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'issue'
        ) as exists
      `,
    );

    expect(first.mode).toBe('migrated');
    expect(second.mode).toBe('current');
    expect(issue?.exists).toBe(true);
  }, 60_000);

  it('does not baseline the unpublished Agent schema from an empty ledger', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), (sql) => sql`truncate drizzle.__drizzle_migrations`);

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      `Legacy baseline has no reconciliation for data migration ${AGENT_SCHEMA_MIGRATION}.`,
    );
    const [ledger] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ count: number }[]>`
        select count(*)::integer as count from drizzle.__drizzle_migrations
      `,
    );

    expect(ledger?.count).toBe(0);
  }, 60_000);

  it('does not baseline a catalog-complete prefix when Agent backfills are pending', async () => {
    await resetScratch();
    await migrateScratch();
    await run(
      urlFor(SCRATCH),
      (sql) => sql`
        delete from drizzle.__drizzle_migrations
        where created_at = (select max(created_at) from drizzle.__drizzle_migrations)
      `,
    );

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      `Legacy baseline has no reconciliation for data migration ${AGENT_SCHEMA_MIGRATION}.`,
    );
    const [ledger] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ count: number }[]>`
        select count(*)::integer as count from drizzle.__drizzle_migrations
      `,
    );

    expect(ledger?.count).toBe(UPSTREAM_MIGRATION_COUNT);
  }, 60_000);

  it('refuses a missing historical constraint without inventing a ledger repair', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`alter table mcp_grant drop constraint mcp_grant_agent_binding_fk`;
    });

    await expect(releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).rejects.toThrow(
      'database is still incompatible',
    );
  }, 60_000);

  it('runs a pending table-drop migration instead of baselining it away', async () => {
    await resetScratch();
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const dropIndex = migrations.findIndex((migration) =>
      migration.sql.some((statement) => statement.includes('DROP TABLE "module"')),
    );
    expect(dropIndex).toBeGreaterThan(0);
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create schema drizzle`;
      await sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      for (const migration of migrations.slice(0, dropIndex)) {
        for (const statement of migration.sql) await sql.unsafe(statement);
        await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
    });

    const before = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('module', 'module_issue', 'module_link', 'module_member')
        order by table_name
      `,
    );
    expect([...before]).toHaveLength(4);

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const remaining = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('module', 'module_issue', 'module_link', 'module_member')
        order by table_name
      `,
    );
    const ledger = await run(
      urlFor(SCRATCH),
      (sql) => sql`select hash from drizzle.__drizzle_migrations order by created_at`,
    );

    expect(result.mode).toBe('migrated');
    expect(result.applied).toBe(migrations.length - dropIndex);
    expect([...remaining]).toEqual([]);
    expect(ledger.map((row) => row['hash'])).toEqual(migrations.map((migration) => migration.hash));
  }, 60_000);
});
