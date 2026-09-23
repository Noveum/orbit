import { afterAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';
import { applyCatchup } from '../../src/apply-catchup.ts';
import {
  catalogDriftBetween,
  expectedCatalog,
  isBehind,
  liveCatalog,
} from '../../src/check-drift.ts';
import { releaseDatabase } from '../../src/migration-release.ts';
import * as schema from '../../src/schema/index.ts';

const database = laneDatabase('orbit_test_p1regression', currentLane());
const base = new URL(process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit');
base.pathname = '/postgres';
const admin = postgres(base.toString(), { max: 1, onnotice: () => undefined });
base.pathname = `/${database}`;
const url = base.toString();
const migrations = fileURLToPath(new URL('../../drizzle', import.meta.url));

async function run<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

async function reset(legacy = false): Promise<void> {
  await admin.unsafe(`drop database if exists "${database}"`);
  await admin.unsafe(`create database "${database}"`);
  if (!legacy) {
    await releaseDatabase(url, migrations);
    return;
  }
  await run(async (sql) => {
    await sql`create extension pg_trgm`;
    for (const migration of readMigrationFiles({ migrationsFolder: migrations }).slice(0, 17)) {
      for (const statement of migration.sql) await sql.unsafe(statement);
    }
  });
}

async function seed(legacy = false): Promise<void> {
  await run(async (sql) => {
    await sql`insert into "user" (id, name, email, handle) values ('owner', 'Owner', 'p1@example.com', 'p1owner')`;
    await sql`insert into organization (id, name, slug) values ('org', 'Workspace', 'p1org')`;
    await sql`insert into team (id, organization_id, name, key) values ('team', 'org', 'Team', 'P1')`;
    await sql`insert into workflow_state (id, organization_id, team_id, name, category, color) values ('state', 'org', 'team', 'Todo', 'unstarted', '#000')`;
    await sql`insert into oauth_application (id, client_id, name, redirect_urls, type) values ('client', 'client', 'Client', 'https://example.com', 'web')`;
    await sql.unsafe(
      `insert into issue (id, organization_id, team_id, number, identifier, title, state_id, creator_id, assignee_id${legacy ? '' : ', creator_user_id, assignee_user_id, owner_user_id'}) values ('issue', 'org', 'team', 1, 'P1-1', 'Issue', 'state', 'owner', 'owner'${legacy ? '' : ", 'owner', 'owner', 'owner'"})`,
    );
    if (!legacy) {
      await sql`insert into agent_identity (id, organization_id, owner_user_id, owner_name_snapshot, client_id, client_name_snapshot, name) values ('agent', 'org', 'owner', 'Owner', 'client', 'Client', 'Agent')`;
    }
  });
}

async function deletedHistory(): Promise<void> {
  await run(async (sql) => {
    await sql`insert into issue_activity (id, organization_id, issue_id, actor_type, actor_id, actor_name, field) values ('activity', 'org', 'issue', 'user', 'deleted-user', 'Historical Name', 'title')`;
    await sql`insert into audit_log (id, organization_id, actor_type, actor_id, actor_name, action, entity_type, entity_id) values ('audit', 'org', 'user', 'deleted-user', 'Historical Name', 'issue.updated', 'issue', 'issue')`;
    await sql`insert into notification (id, organization_id, user_id, type, actor_type, actor_id, actor_name, entity_type, entity_id, title, url) values ('notification', 'org', 'owner', 'issue', 'user', 'deleted-user', 'Historical Name', 'issue', 'issue', 'Issue', '/issue/P1-1')`;
  });
}

function fingerprint(): Promise<string> {
  return run(async (sql) => {
    const result: unknown[] = [];
    for (const table of [
      'issue',
      'issue_activity',
      'audit_log',
      'notification',
      'mcp_grant',
      'oauth_access_token',
      'agent_identity',
    ]) {
      const [existing] = await sql`select to_regclass(${table}) as name`;
      if (existing?.['name'] === null) continue;
      result.push(await sql.unsafe(`select * from "${table}" order by id`));
    }
    return JSON.stringify(result);
  });
}

afterAll(async () => {
  await admin.unsafe(`drop database if exists "${database}"`);
  await admin.end();
});

describe('Phase 1 database regressions', () => {
  it('upgrades an original 0016 ledger with deleted Human attribution through release', async () => {
    await reset(true);
    await seed(true);
    await deletedHistory();
    await run(async (sql) => {
      await sql`create schema drizzle`;
      await sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
      for (const migration of readMigrationFiles({ migrationsFolder: migrations }).slice(0, 17)) {
        await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${migration.hash}, ${migration.folderMillis})`;
      }
    });
    const result = await releaseDatabase(url, migrations);
    expect(result.mode).toBe('migrated');
    for (const table of ['issue_activity', 'audit_log', 'notification']) {
      const [row] = await run((sql) =>
        sql.unsafe<
          {
            actor_id: string;
            actor_name: string;
            principal_user_id: string | null;
            principal_name: string | null;
          }[]
        >(`select actor_id, actor_name, principal_user_id, principal_name from "${table}"`),
      );
      expect(row).toEqual({
        actor_id: 'deleted-user',
        actor_name: 'Historical Name',
        principal_user_id: null,
        principal_name: 'Historical Name',
      });
    }
    expect((await releaseDatabase(url, migrations)).mode).toBe('current');
  }, 60_000);

  it('rejects a revoked unbound Grant without its mandatory freeze reason', async () => {
    await reset();
    await seed();
    await expect(
      run(
        (
          sql,
        ) => sql`insert into mcp_grant (id, client_id, user_id, organization_id, principal_name_snapshot, scopes, revoked_at, revoke_reason)
      values ('unexplained', 'client', 'owner', 'org', 'Owner', 'orbit.read', now(), null)`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('F3 upgrades a no-ledger 0016 database, reconciles data, and is repeatable', async () => {
    await reset(true);
    await seed(true);
    await deletedHistory();
    await run(async (sql) => {
      await sql`insert into mcp_grant (id, client_id, user_id, organization_id, scopes) values ('legacy', 'client', 'owner', 'org', 'orbit.read')`;
      await sql`insert into oauth_access_token (id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, client_id, user_id, scopes) values ('token', 'access', 'refresh', now(), now(), 'client', 'owner', 'orbit.read')`;
    });
    await applyCatchup(url, 'agent-actors.sql');
    const first = await fingerprint();
    await applyCatchup(url, 'agent-actors.sql');
    expect(await fingerprint()).toBe(first);
    expect(isBehind(catalogDriftBetween(expectedCatalog(schema), await liveCatalog(url)))).toBe(
      false,
    );
    const released = await releaseDatabase(url, migrations);
    expect(released.mode).toBe('baselined');
    expect(await fingerprint()).toBe(first);
    const [row] = await run(
      (sql) => sql`select creator_user_id, assignee_user_id, owner_user_id from issue`,
    );
    expect(row).toEqual({
      creator_user_id: 'owner',
      assignee_user_id: 'owner',
      owner_user_id: 'owner',
    });
    const [grant] = await run(
      (sql) => sql`select revoked_at is not null as revoked, revoke_reason from mcp_grant`,
    );
    expect(grant).toEqual({ revoked: true, revoke_reason: 'agent_identity_required' });
    expect(await run((sql) => sql`select id from oauth_access_token`)).toHaveLength(0);
  }, 30_000);

  it('F3 reconciles 0021 token revocation when baselining an already additive schema', async () => {
    await reset();
    await seed();
    await run(async (sql) => {
      await sql`insert into mcp_grant (id, client_id, user_id, organization_id, principal_name_snapshot, scopes, revoked_at, revoke_reason) values ('legacy', 'client', 'owner', 'org', 'Owner', 'orbit.read', now(), 'agent_identity_required')`;
      await sql`insert into oauth_access_token (id, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, client_id, user_id, scopes) values ('token', 'access', 'refresh', now(), now(), 'client', 'owner', 'orbit.read')`;
      await sql`drop schema drizzle cascade`;
    });
    expect((await releaseDatabase(url, migrations)).mode).toBe('baselined');
    expect(await run((sql) => sql`select id from oauth_access_token`)).toHaveLength(0);
  });

  for (const ledger of ['missing', 'prefix']) {
    it(`F3/F5 reconciles deleted Human history before baselining a ${ledger} ledger`, async () => {
      await reset();
      await seed();
      await deletedHistory();
      await run(async (sql) => {
        if (ledger === 'missing') {
          await sql`drop schema drizzle cascade`;
        } else {
          const legacy = readMigrationFiles({ migrationsFolder: migrations }).at(16);
          if (legacy === undefined) throw new Error('Missing legacy migration');
          await sql`delete from drizzle.__drizzle_migrations where created_at > ${legacy.folderMillis}`;
        }
      });
      expect((await releaseDatabase(url, migrations)).mode).toBe('baselined');
      for (const table of ['issue_activity', 'audit_log', 'notification']) {
        const [row] = await run((sql) =>
          sql.unsafe<
            {
              actor_id: string;
              actor_name: string;
              principal_user_id: string | null;
              principal_name: string | null;
              grant_id: string | null;
            }[]
          >(
            `select actor_id, actor_name, principal_user_id, principal_name, grant_id from "${table}"`,
          ),
        );
        expect(row).toEqual({
          actor_id: 'deleted-user',
          actor_name: 'Historical Name',
          principal_user_id: null,
          principal_name: 'Historical Name',
          grant_id: null,
        });
      }
      const first = await fingerprint();
      expect((await releaseDatabase(url, migrations)).mode).toBe('current');
      expect(await fingerprint()).toBe(first);
    });
  }

  it('F3 rolls back an interrupted catch-up and retries across multiple backfill batches', async () => {
    await reset(true);
    await seed(true);
    await run(
      (
        sql,
      ) => sql`insert into issue (id, organization_id, team_id, number, identifier, title, state_id, creator_id, assignee_id)
      select 'batch-' || lpad(n::text, 4, '0'), 'org', 'team', n + 1, 'P1-' || (n + 1), 'Batch', 'state', 'owner', null from generate_series(1, 1005) n`,
    );
    const before = await fingerprint();
    await run((sql) =>
      sql
        .unsafe(`
        create function fail_catchup_batch() returns trigger as $$
        begin
          if new.id = 'batch-1001' then
            raise exception 'injected catchup failure';
          end if;
          return new;
        end;
        $$ language plpgsql;
        create trigger fail_catchup_batch_trigger
        before update on issue
        for each row execute function fail_catchup_batch();
      `)
        .simple(),
    );
    try {
      await expect(applyCatchup(url, 'agent-actors.sql')).rejects.toThrow(
        'injected catchup failure',
      );
    } finally {
      await run((sql) =>
        sql
          .unsafe(`
          drop trigger fail_catchup_batch_trigger on issue;
          drop function fail_catchup_batch();
        `)
          .simple(),
      );
    }
    expect(await fingerprint()).toBe(before);
    await applyCatchup(url, 'agent-actors.sql');
    const [counts] = await run(
      (sql) =>
        sql`select count(*)::int as total, count(creator_user_id)::int as creators from issue`,
    );
    expect(counts).toMatchObject({ total: 1006, creators: 1006 });
    const migrated = await fingerprint();
    await applyCatchup(url, 'agent-actors.sql');
    expect(await fingerprint()).toBe(migrated);
  }, 30_000);

  for (const variant of [
    'identity-null',
    'user-null',
    'owner-disabled',
    'admin-disabled',
    'deleted',
  ]) {
    it(`F4 rejects an active grant with ${variant}`, async () => {
      await reset();
      await seed();
      await run(async (sql) => {
        if (variant === 'owner-disabled')
          await sql`update agent_identity set owner_disabled_at = now()`;
        if (variant === 'admin-disabled')
          await sql`update agent_identity set admin_disabled_at = now()`;
        if (variant === 'deleted') await sql`update agent_identity set deleted_at = now()`;
      });
      await expect(
        run(
          (sql) =>
            sql`insert into mcp_grant (id, client_id, user_id, organization_id, agent_identity_id, principal_name_snapshot, scopes) values ('grant', 'client', ${variant === 'user-null' ? null : 'owner'}, 'org', ${variant === 'identity-null' ? null : 'agent'}, 'Owner', 'orbit.read')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  }

  it('F4 rejects disabling an identity while its grant remains active', async () => {
    await reset();
    await seed();
    await run(
      (sql) =>
        sql`insert into mcp_grant (id, client_id, user_id, organization_id, agent_identity_id, principal_name_snapshot, scopes) values ('grant', 'client', 'owner', 'org', 'agent', 'Owner', 'orbit.read')`,
    );
    await expect(
      run((sql) => sql`update agent_identity set owner_disabled_at = now()`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('F5 backfills deleted Human history without inventing a principal FK', async () => {
    await reset();
    await seed();
    await deletedHistory();
    await applyCatchup(url, 'agent-actors.sql');
    for (const table of ['issue_activity', 'audit_log', 'notification']) {
      const [row] = await run((sql) =>
        sql.unsafe(`select principal_user_id, principal_name, grant_id from "${table}"`),
      );
      expect(row).toMatchObject({
        principal_user_id: null,
        principal_name: 'Historical Name',
        grant_id: null,
      });
    }
  });

  it('F5 permits FK owner clearing for a deleted identity while preserving snapshots', async () => {
    await reset();
    await seed();
    await run(async (sql) => {
      await sql`insert into "user" (id, name, email, handle) values ('former', 'Former', 'former@example.com', 'former')`;
      await sql`insert into agent_identity (id, organization_id, owner_user_id, owner_name_snapshot, client_id, client_name_snapshot, name, deleted_at) values ('tombstone', 'org', 'former', 'Former', 'client', 'Client', 'Archived', now())`;
      await sql`insert into mcp_grant (id, client_id, user_id, organization_id, agent_identity_id, principal_name_snapshot, scopes, revoked_at) values ('historic-grant', 'client', 'former', 'org', 'tombstone', 'Former', 'orbit.read', now())`;
      await sql`delete from "user" where id = 'former'`;
    });
    const [row] = await run(
      (sql) =>
        sql`select owner_user_id, owner_name_snapshot, name from agent_identity where id = 'tombstone'`,
    );
    expect(row).toEqual({ owner_user_id: null, owner_name_snapshot: 'Former', name: 'Archived' });
    expect(
      (
        await run(
          (sql) =>
            sql`select user_id, principal_name_snapshot from mcp_grant where id = 'historic-grant'`,
        )
      )[0],
    ).toMatchObject({ user_id: null, principal_name_snapshot: 'Former' });
    await expect(
      run((sql) => sql`update agent_identity set owner_user_id = 'owner' where id = 'tombstone'`),
    ).rejects.toThrow();
  });

  it('F6 detects a validated CHECK with different boolean grouping in the real catalog', async () => {
    await reset();
    const expected = await liveCatalog(url);
    await run(async (sql) => {
      await sql`alter table issue drop constraint issue_creator_actor_check`;
      await sql`alter table issue add constraint issue_creator_actor_check check (creator_user_id is not null and (creator_agent_id is null or creator_user_id is null) and creator_agent_id is not null)`;
    });
    const drift = catalogDriftBetween(expected, await liveCatalog(url));
    expect(drift.checkMismatches).toContainEqual(
      expect.objectContaining({ table: 'issue', name: 'issue_creator_actor_check' }),
    );
    expect(isBehind(drift)).toBe(true);
  });

  it('F8 includes Agent cycle snapshots and both assignee activity fields', async () => {
    await reset();
    const catalog = await liveCatalog(url);
    expect(
      catalog.tables
        .find((table) => table.name === 'cycle_issue_membership')
        ?.columns.map((column) => column.name),
    ).toContain('assignee_agent_id_at_add');
    expect(
      catalog.tables
        .find((table) => table.name === 'cycle_issue_outcome')
        ?.columns.map((column) => column.name),
    ).toContain('assignee_agent_id_at_close');
    expect(
      catalog.tables
        .find((table) => table.name === 'issue_activity')
        ?.indexes.find((index) => index.name.includes('assignee'))?.predicate,
    ).toContain("'assignee'");
  });
});
