import { afterAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
import { applyCatchup } from '../src/apply-catchup.ts';
import { releaseDatabase } from '../src/migration-release.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_migration_release', currentLane());
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

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

async function useHistoricalAgentInstructionsLedger(): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
  await run(urlFor(SCRATCH), async (sql) => {
    await sql`delete from drizzle.__drizzle_migrations where created_at > 1787233740635`;
    for (const migration of migrations.slice(0, 13)) {
      const source = migration.sql.join('--> statement-breakpoint');
      const alternateHash = ['\n', '\r\n']
        .map((lineEnding) =>
          createHash('sha256').update(source.replace(/\r?\n/gu, lineEnding)).digest('hex'),
        )
        .find((hash) => hash !== migration.hash);
      if (alternateHash !== undefined) {
        await sql`
          update drizzle.__drizzle_migrations set hash = ${alternateHash}
          where created_at = ${migration.folderMillis}
        `;
      }
    }
    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (
        '53266292651bb8f1368abee0336030f12a780e2086f7d7cbbf49142b4550faeb',
        1787562015902
      )
    `;
  });
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

describe('database release', () => {
  it('upgrades the original ledger prefix atomically and retries without losing consent history', async () => {
    await resetScratch();
    const historical = readMigrationFiles({ migrationsFolder: MIGRATIONS }).slice(0, 22);
    await run(urlFor(SCRATCH), async (sql) => {
      await sql.begin(async (tx) => {
        await tx`create schema drizzle`;
        await tx`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
        for (const migration of historical) {
          const statements =
            migration.folderMillis === 1789829740142 ? [...migration.sql].reverse() : migration.sql;
          for (const statement of statements) await tx.unsafe(statement);
          await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
        }
      });
      await sql`insert into "user" (id, name, email, handle) values ('upgrade-owner', 'Owner', 'upgrade@example.com', 'upgrade-owner')`;
      await sql`insert into organization (id, name, slug) values ('upgrade-org', 'Org', 'upgrade-org')`;
      await sql`insert into oauth_application (id, client_id, name, redirect_urls, type) values ('upgrade-client', 'upgrade-client', 'Client', 'https://example.com', 'public')`;
      await sql`insert into mcp_grant (id, client_id, user_id, organization_id, scopes, principal_name_snapshot, revoked_at) values ('upgrade-grant', 'upgrade-client', 'upgrade-owner', 'upgrade-org', 'orbit.read', 'Owner', now())`;
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
          sql`select column_name from information_schema.columns where table_name = 'cycle_issue_membership' and column_name = 'assignee_agent_id_at_add'`,
      ),
    ).toHaveLength(0);
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`drop trigger reject_upgrade_trigger on mcp_grant`;
      await sql`drop function reject_upgrade()`;
    });
    expect((await releaseDatabase(urlFor(SCRATCH), MIGRATIONS)).applied).toBe(
      readMigrationFiles({ migrationsFolder: MIGRATIONS }).length - historical.length,
    );
    expect([
      ...(await run(
        urlFor(SCRATCH),
        (sql) => sql`select * from drizzle.__drizzle_migrations order by id limit 22`,
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

  it('P0-MIG-1 rolls back partial P3 DDL and the migration ledger after interruption', async () => {
    const target = `${SCRATCH}_p3_interrupt`;
    const prefixDirectory = await migrationPrefixDirectory('0024_preserve_agent_identity_history');
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
      expect(afterFailure).toEqual({ outbox: null, ledger_count: 25 });

      await run(urlFor(target), (sql) => sql`drop table public.mcp_idempotency`);
      const retried = await releaseDatabase(urlFor(target), MIGRATIONS);
      expect(retried.mode).toBe('migrated');
      expect(retried.applied).toBe(5);
      const [afterRetry] = await run(
        urlFor(target),
        (sql) => sql<{ outbox: string | null; ledger_count: number }[]>`
          select
            to_regclass('public.issue_outbox')::text as outbox,
            (select count(*)::integer from drizzle.__drizzle_migrations) as ledger_count
        `,
      );
      expect(afterRetry).toEqual({ outbox: 'issue_outbox', ledger_count: 30 });
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

  it('rebaselines the recognized historical ledger after the full schema is verified', async () => {
    await resetScratch();
    await migrateScratch();
    await useHistoricalAgentInstructionsLedger();

    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const ledger = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ hash: string; created_at: string }[]>`
        select hash, created_at from drizzle.__drizzle_migrations order by created_at, id
      `,
    );

    expect(result).toEqual({ mode: 'baselined', applied: 0, total: migrations.length });
    expect([...ledger]).toEqual(
      migrations.map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
    );
  }, 60_000);

  it('keeps the historical ledger unchanged when its schema is incomplete', async () => {
    await resetScratch();
    await migrateScratch();
    await useHistoricalAgentInstructionsLedger();
    await run(urlFor(SCRATCH), (sql) => sql`drop table issue_outbox`);
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

  it('repairs an empty legacy ledger without replaying migrations', async () => {
    await resetScratch();
    await migrateScratch();
    await run(urlFor(SCRATCH), (sql) => sql`truncate drizzle.__drizzle_migrations`);

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const [ledger] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ count: number }[]>`
        select count(*)::integer as count from drizzle.__drizzle_migrations
      `,
    );

    expect(result).toEqual({ mode: 'baselined', applied: 0, total: migrations.length });
    expect(ledger?.count).toBe(migrations.length);
  }, 60_000);

  it('repairs a catalog-complete ledger prefix without replaying the pending migration', async () => {
    await resetScratch();
    await migrateScratch();
    await run(
      urlFor(SCRATCH),
      (sql) => sql`
        delete from drizzle.__drizzle_migrations
        where created_at = (select max(created_at) from drizzle.__drizzle_migrations)
      `,
    );

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const [ledger] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ count: number }[]>`
        select count(*)::integer as count from drizzle.__drizzle_migrations
      `,
    );

    expect(result).toEqual({ mode: 'baselined', applied: 0, total: migrations.length });
    expect(ledger?.count).toBe(migrations.length);
  }, 60_000);

  it('keeps the original historical migration ledger without inserting compatibility records', async () => {
    await resetScratch();
    await migrateScratch();
    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const [recorded] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ count: number }[]>`
        select count(*)::integer as count
        from drizzle.__drizzle_migrations
        where created_at = 1789829500000
      `,
    );

    expect(result.mode).toBe('current');
    expect(recorded?.count).toBe(0);
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
});
