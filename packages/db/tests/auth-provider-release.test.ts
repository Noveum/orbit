import { afterAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
import { releaseDatabase } from '../src/migration-release.ts';

const configured = new URL(process.env['DATABASE_URL'] ?? 'http://invalid');
const scratch = laneDatabase('orbit_test_auth_provider_release', currentLane());
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder: folder });
const clientMigration = migrations.find((migration) =>
  migration.sql.some((statement) => statement.includes('Unsupported legacy OAuth client records')),
);
const authSchemaIndex = migrations.findIndex((migration) =>
  migration.sql.some((statement) => statement.trimStart().startsWith('CREATE TABLE "auth_jwks"')),
);
const authSchemaMigration = migrations[authSchemaIndex];
if (authSchemaMigration === undefined) throw new Error('The auth schema migration is missing.');
if (clientMigration === undefined) throw new Error('The auth client migration is missing.');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(configured.hostname))
  throw new Error('A loopback test connection is required.');

async function connection<T>(database: string, run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  if (database !== 'postgres' && database !== scratch)
    throw new Error('The requested database is outside this test scope.');
  const target = new URL(configured);
  target.pathname = `/${database}`;
  const sql = postgres(target.toString(), { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const [actual] = await sql<{ name: string }[]>`select current_database() as name`;
    if (actual?.name !== database) throw new Error('The actual test database does not match.');
    return await run(sql);
  } finally {
    await sql.end();
  }
}

async function dropScratch(): Promise<void> {
  await connection('postgres', async (sql) => {
    const [active] = await sql<
      { count: number }[]
    >`select count(*)::int as count from pg_stat_activity where datname=${scratch}`;
    if (active?.count !== 0)
      throw new Error('The owned auth release scratch database is still in use.');
    await sql.unsafe(`drop database if exists "${scratch}"`);
  });
}

describe('auth provider release baseline', () => {
  afterAll(dropScratch, 30000);
  for (const ledger of ['absent', 'prefix'] as const) {
    it(`reconciles copied auth clients with a ${ledger} ledger and preapplied schema`, async () => {
      await dropScratch();
      await connection('postgres', (sql) => sql.unsafe(`create database "${scratch}"`));
      await connection(scratch, async (sql) => {
        await sql`create extension if not exists pg_trgm`;
        await migrate(drizzle({ client: sql }), { migrationsFolder: folder });
        await sql`insert into oauth_application (id, client_id, name, type, client_secret, redirect_urls, disabled) values
          ('release-public', 'release-public', 'Public', 'public', null, 'http://127.0.0.1:9000/callback', false),
          ('release-web', 'release-web', 'Web', 'web', 'local-release-secret', 'https://client.example.test/callback', true)`;
        if (ledger === 'absent') await sql`drop schema drizzle cascade`;
        else
          await sql`delete from drizzle.__drizzle_migrations where created_at >= ${authSchemaMigration.folderMillis}`;
      });
      const url = new URL(configured);
      url.pathname = `/${scratch}`;
      expect((await releaseDatabase(url.toString(), folder)).mode).toBe('baselined');
      await connection(scratch, async (sql) => {
        const clients =
          await sql`select client_id, client_secret, token_endpoint_auth_method, disabled from oauth_provider_client order by client_id`;
        expect(clients).toHaveLength(2);
        expect(clients[0]?.['token_endpoint_auth_method']).toBe('none');
        expect(clients[0]?.['client_secret']).toBeNull();
        expect(
          clients[1]?.['client_secret'] ===
            createHash('sha256').update('local-release-secret').digest('base64url'),
        ).toBe(true);
        expect(clients[1]?.['disabled']).toBe(true);
        expect(await sql`select * from drizzle.__drizzle_migrations`).toHaveLength(
          migrations.length,
        );
      });
      expect((await releaseDatabase(url.toString(), folder)).mode).toBe('current');
    }, 60000);
  }
  it('rolls back client reconciliation without advancing the preapplied ledger for malformed metadata', async () => {
    await dropScratch();
    await connection('postgres', (sql) => sql.unsafe(`create database "${scratch}"`));
    await connection(scratch, async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      await migrate(drizzle({ client: sql }), { migrationsFolder: folder });
      await sql`delete from drizzle.__drizzle_migrations where created_at >= ${authSchemaMigration.folderMillis}`;
      await sql`insert into oauth_application (id, client_id, name, type, redirect_urls, metadata)
        values ('malformed', 'malformed', 'Malformed', 'public', 'http://127.0.0.1:9000/callback', '{invalid')`;
    });
    const url = new URL(configured);
    url.pathname = `/${scratch}`;
    await expect(releaseDatabase(url.toString(), folder)).rejects.toThrow(
      'Legacy OAuth client metadata must be valid JSON',
    );
    await connection(scratch, async (sql) => {
      expect(await sql`select * from oauth_provider_client`).toHaveLength(0);
      expect(await sql`select * from drizzle.__drizzle_migrations`).toHaveLength(authSchemaIndex);
    });
  }, 60000);
});
