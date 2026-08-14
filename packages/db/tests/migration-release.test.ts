import { afterAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
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
  await run(urlFor(SCRATCH), async (sql) => {
    await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS });
  });
}

describe('database release', () => {
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
});
