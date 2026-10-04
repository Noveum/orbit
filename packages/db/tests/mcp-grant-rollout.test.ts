import { afterAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from '../src/check-drift.ts';
import { releaseDatabase } from '../src/migration-release.ts';
import * as schema from '../src/schema/index.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_mcp_rollout', currentLane());
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const PR1_MIGRATION = 1791120831827;

function urlFor(database: string): string {
  const url = new URL(BASE);
  url.pathname = `/${database}`;
  return url.toString();
}

async function run<T>(work: (sql: postgres.Sql) => Promise<T>, database = SCRATCH): Promise<T> {
  const sql = postgres(urlFor(database), { max: 1, prepare: false });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

async function legacyRows(sql: postgres.Sql): Promise<Record<string, unknown>[]> {
  return [
    ...(await sql<Record<string, unknown>[]>`
    select 'grant' as kind, to_jsonb(mcp_grant)
      - 'identity_kind' - 'agent_identity_id' - 'owner_member_id' as payload from mcp_grant
    union all select 'token', to_jsonb(oauth_access_token) - 'mcp_grant_id' from oauth_access_token
    union all select 'consent', to_jsonb(oauth_consent) from oauth_consent
    union all select 'identity', to_jsonb(agent_identity) from agent_identity
    order by kind
  `),
  ];
}

describe('MCP grant compatibility rollout', () => {
  afterAll(async () => {
    await run((sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`), 'postgres');
  }, 30_000);

  it('preserves legacy data, old consent SQL and the minimal identity contract', async () => {
    await run(async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    }, 'postgres');
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const prefix = migrations.filter((migration) => migration.folderMillis <= PR1_MIGRATION);
    expect(prefix).toHaveLength(31);
    await run(async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      for (const migration of prefix) {
        for (const statement of migration.sql) await sql.unsafe(statement);
      }
      await sql`create schema drizzle`;
      await sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      for (const migration of prefix) {
        await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
      await sql`insert into "user" (id, name, email, handle) values ('rollout-owner', 'Owner', 'rollout@example.com', 'rollout-owner')`;
      await sql`insert into organization (id, name, slug) values ('rollout-org', 'Workspace', 'rollout-org')`;
      await sql`
        insert into oauth_application (id, name, client_id, redirect_urls, type)
        values ('rollout-app', 'Client', 'rollout-client', 'https://example.com/callback', 'public')
      `;
      await sql`
        insert into mcp_grant (id, client_id, user_id, organization_id, scopes)
        values ('rollout-grant', 'rollout-client', 'rollout-owner', 'rollout-org', 'orbit.read orbit.write')
      `;
      await sql`
        insert into oauth_access_token (
          id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at,
          client_id, user_id, scopes
        ) values (
          'rollout-token', 'old-access', 'old-refresh', now() + interval '1 day',
          now() + interval '30 days', 'rollout-client', 'rollout-owner', 'orbit.read orbit.write'
        )
      `;
      await sql`
        insert into oauth_consent (id, client_id, user_id, scopes, consent_given)
        values ('rollout-consent', 'rollout-client', 'rollout-owner', 'orbit.read orbit.write', true)
      `;
      await sql`
        insert into agent_identity (id, organization_id, name, owner_name_snapshot, client_name_snapshot)
        values ('rollout-history', 'rollout-org', 'Historical identity', 'Owner snapshot', 'Client snapshot')
      `;
    });
    const before = await run(legacyRows);
    const first = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    expect(first.mode).toBe('migrated');
    expect(first.applied).toBe(migrations.length - prefix.length);
    expect(await run(legacyRows)).toEqual(before);
    await run(async (sql) => {
      const [grant] =
        await sql`select identity_kind, agent_identity_id, owner_member_id, revoked_at from mcp_grant`;
      expect(grant).toMatchObject({
        identity_kind: 'legacy',
        agent_identity_id: null,
        owner_member_id: null,
        revoked_at: null,
      });
      const [token] =
        await sql`select access_token, refresh_token, mcp_grant_id from oauth_access_token`;
      expect(token).toMatchObject({
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        mcp_grant_id: null,
      });
      await sql`
        insert into mcp_grant (id, client_id, user_id, organization_id, scopes)
        values ('rollout-rotated', 'rollout-client', 'rollout-owner', 'rollout-org', 'orbit.read')
        on conflict (client_id, user_id) do update set id = excluded.id, scopes = excluded.scopes
      `;
      const grants = await sql`select id, identity_kind, agent_identity_id from mcp_grant`;
      expect([...grants]).toEqual([
        { id: 'rollout-rotated', identity_kind: 'legacy', agent_identity_id: null },
      ]);
      await sql`
        insert into agent_identity (id, organization_id, name, owner_name_snapshot, client_name_snapshot)
        values ('rollout-fixture', 'rollout-org', 'Minimal identity', 'Owner snapshot', 'Client snapshot')
      `;
      const [identity] =
        await sql`select owner_user_id, client_id from agent_identity where id = 'rollout-fixture'`;
      expect(identity).toMatchObject({ owner_user_id: null, client_id: null });
      const [globalIndex] =
        await sql`select indisunique from pg_index where indexrelid = to_regclass('mcp_grant_client_user_unique')`;
      expect(globalIndex?.['indisunique']).toBe(true);
      const [count] = await sql`select count(*)::integer as total from agent_identity`;
      expect(count?.['total']).toBe(2);
    });
    const afterWrites = await run(legacyRows);
    const second = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    expect(second.mode).toBe('current');
    expect(second.applied).toBe(0);
    expect(await run(legacyRows)).toEqual(afterWrites);
    expect(
      isBehind(catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)))),
    ).toBe(false);
  }, 60_000);
});
