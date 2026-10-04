import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';
import {
  catalogDriftBetween,
  expectedCatalog,
  isBehind,
  liveCatalog,
} from '../../src/check-drift.ts';
import { type ReleaseResult, releaseDatabase } from '../../src/migration-release.ts';
import * as schema from '../../src/schema/index.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase(
  'orbit_test_actor_expand',
  `${currentLane()}${randomUUID().replace(/-/g, '').slice(0, 8)}`,
);
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
const expansionIndex = migrations.findIndex(
  (migration) => migration.folderMillis === 1791120831827,
);
const expansion = migrations[expansionIndex];
const oldMigrations = migrations.slice(0, expansionIndex);

interface PayloadRow {
  readonly payload: Record<string, unknown>;
}

interface BusinessState {
  readonly issues: readonly PayloadRow[];
  readonly activities: readonly PayloadRow[];
  readonly notifications: readonly PayloadRow[];
  readonly grants: readonly PayloadRow[];
  readonly tokens: readonly PayloadRow[];
  readonly consents: readonly PayloadRow[];
  readonly sequence: { readonly last_value: string; readonly is_called: boolean } | undefined;
}

interface ActorColumns {
  readonly creator_id: string;
  readonly assignee_id: string | null;
  readonly creator_user_id: string | null;
  readonly creator_agent_id: string | null;
  readonly assignee_user_id: string | null;
  readonly assignee_agent_id: string | null;
  readonly owner_user_id: string | null;
}

let initialState: BusinessState | undefined;
let initialRelease: ReleaseResult | undefined;
let created = false;

function legacyBusinessState(): BusinessState {
  if (initialState === undefined) throw new Error('The legacy database fixture was not captured.');
  return initialState;
}

function urlFor(database: string): string {
  const url = new URL(BASE);
  url.pathname = `/${database}`;
  return url.toString();
}

async function run<T>(work: (sql: postgres.Sql) => Promise<T>, database = SCRATCH): Promise<T> {
  const sql = postgres(urlFor(database), {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

async function rolledBack(work: (tx: postgres.TransactionSql) => Promise<void>): Promise<void> {
  const rollback = new Error('actor expansion test rollback');
  await run(async (sql) => {
    try {
      await sql.begin(async (tx) => {
        await work(tx);
        throw rollback;
      });
    } catch (error: unknown) {
      if (error !== rollback) throw error;
    }
  });
}

async function runLegacyHelper(args: readonly string[] = []): Promise<void> {
  const helper = fileURLToPath(new URL('./actor-legacy-writes.ts', import.meta.url));
  const child = Bun.spawn(['bun', helper, ...args], {
    env: { ...process.env, DATABASE_URL: urlFor(SCRATCH), REDIS_URL: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, output: `${stdout}${stderr}` }).toMatchObject({ exitCode: 0 });
}

function backfillStatement(migration: MigrationMeta | undefined): string {
  const statements = migration?.sql.filter((statement) =>
    /^\s*update\s+(?:"issue"|issue)\s/iu.test(statement),
  );
  if (statements?.length !== 1 || statements[0] === undefined) {
    throw new Error('The actor expansion must contain exactly one issue backfill.');
  }
  return statements[0];
}

async function readBusinessState(sql: postgres.Sql): Promise<BusinessState> {
  const issues = await sql<PayloadRow[]>`
    select to_jsonb(issue)
      - 'creator_user_id' - 'creator_agent_id'
      - 'assignee_user_id' - 'assignee_agent_id' - 'owner_user_id' as payload
    from issue order by id
  `;
  const activities = await sql<PayloadRow[]>`
    select to_jsonb(issue_activity) as payload from issue_activity order by id
  `;
  const notifications = await sql<PayloadRow[]>`
    select to_jsonb(notification) as payload from notification order by id
  `;
  const grants = await sql<PayloadRow[]>`
    select to_jsonb(mcp_grant) - 'identity_kind' - 'agent_identity_id' - 'owner_member_id'
      as payload from mcp_grant order by id
  `;
  const tokens = await sql<PayloadRow[]>`
    select to_jsonb(oauth_access_token) - 'mcp_grant_id' as payload from oauth_access_token order by id
  `;
  const consents = await sql<PayloadRow[]>`
    select to_jsonb(oauth_consent) as payload from oauth_consent order by id
  `;
  const [sequence] = await sql<{ last_value: string; is_called: boolean }[]>`
    select last_value::text as last_value, is_called from sync_id_seq
  `;
  return {
    issues: [...issues],
    activities: [...activities],
    notifications: [...notifications],
    grants: [...grants],
    tokens: [...tokens],
    consents: [...consents],
    sequence,
  };
}

async function seedLegacyData(sql: postgres.Sql): Promise<void> {
  await sql`
    insert into "user" (id, name, email, handle) values
      ('expand-creator', 'Creator', 'creator@expand.test', 'expand-creator'),
      ('expand-first', 'First assignee', 'first@expand.test', 'expand-first'),
      ('expand-second', 'Second assignee', 'second@expand.test', 'expand-second')
  `;
  await sql`
    insert into organization (id, name, slug)
    values ('expand-org', 'Expansion', 'expand-org')
  `;
  await sql`
    insert into team (id, organization_id, name, key)
    values ('expand-team', 'expand-org', 'Expansion', 'EXP')
  `;
  await sql`
    insert into member (id, organization_id, user_id, role)
    values ('expand-member', 'expand-org', 'expand-creator', 'admin')
  `;
  await sql`
    insert into team_member (id, team_id, user_id)
    values ('expand-team-member', 'expand-team', 'expand-creator')
  `;
  await sql`
    insert into workflow_state (id, organization_id, team_id, name, category, color)
    values ('expand-state', 'expand-org', 'expand-team', 'Todo', 'unstarted', 'gray')
  `;
  await sql`
    insert into issue (
      id, organization_id, team_id, number, identifier, title, state_id,
      creator_id, assignee_id, sync_id, created_at, updated_at, state_entered_at
    ) values
      (
        'history-assigned', 'expand-org', 'expand-team', 1, 'EXP-1', 'Assigned history',
        'expand-state', 'expand-creator', 'expand-first', 710,
        '2026-07-01T01:00:00Z', '2026-07-02T02:00:00Z', '2026-07-01T01:00:00Z'
      ),
      (
        'history-unassigned', 'expand-org', 'expand-team', 2, 'EXP-2', 'Unassigned history',
        'expand-state', 'expand-creator', null, 711,
        '2026-07-03T03:00:00Z', '2026-07-04T04:00:00Z', '2026-07-03T03:00:00Z'
      )
  `;
  await sql`
    insert into issue_activity (
      id, organization_id, issue_id, actor_id, actor_name, field, sync_id, created_at
    ) values (
      'expand-activity', 'expand-org', 'history-assigned', 'expand-creator',
      'Creator', 'created', 712, '2026-07-01T01:00:00Z'
    )
  `;
  await sql`
    insert into notification (
      id, organization_id, user_id, type, actor_id, actor_name,
      entity_type, entity_id, title, url, sync_id, created_at
    ) values (
      'expand-notification', 'expand-org', 'expand-first', 'assigned', 'expand-creator',
      'Creator', 'issue', 'history-assigned', 'Assigned history', '/EXP-1', 713,
      '2026-07-01T01:00:00Z'
    )
  `;
  await sql`
    insert into oauth_application (id, name, client_id, redirect_urls, type, user_id)
    values (
      'expand-client', 'Existing client', 'expand-client',
      'http://localhost/callback', 'public', 'expand-creator'
    )
  `;
  await sql`
    insert into mcp_grant (id, client_id, user_id, organization_id, scopes)
    values (
      'expand-grant', 'expand-client', 'expand-creator', 'expand-org',
      'openid profile email orbit.read orbit.write'
    )
  `;
  await sql`
    insert into oauth_access_token (
      id, access_token, refresh_token, access_token_expires_at,
      refresh_token_expires_at, client_id, user_id, scopes
    ) values (
      'expand-token', 'existing-access-token', 'existing-refresh-token',
      '2030-01-01T00:00:00Z', '2030-02-01T00:00:00Z',
      'expand-client', 'expand-creator', 'orbit.read orbit.write'
    )
  `;
  await sql`
    insert into oauth_consent (id, client_id, user_id, scopes, consent_given)
    values ('expand-consent', 'expand-client', 'expand-creator', 'orbit.read orbit.write', true)
  `;
  await sql`select setval('sync_id_seq', 730, true)`;
}

async function readActors(
  tx: postgres.TransactionSql,
  id: string,
): Promise<ActorColumns | undefined> {
  const [row] = await tx<ActorColumns[]>`
    select creator_id, assignee_id, creator_user_id, creator_agent_id,
      assignee_user_id, assignee_agent_id, owner_user_id
    from issue where id = ${id}
  `;
  return row;
}

async function insertLegacyIssue(
  tx: postgres.TransactionSql,
  assigneeId: string | null,
): Promise<void> {
  await tx`
    insert into issue (
      id, organization_id, team_id, number, identifier, title, state_id, creator_id, assignee_id
    ) values (
      'legacy-write', 'expand-org', 'expand-team', 3, 'EXP-3', 'Old deployment',
      'expand-state', 'expand-creator', ${assigneeId}
    )
  `;
}

describe('actor schema expansion compatibility', () => {
  beforeAll(async () => {
    if (expansion === undefined) throw new Error('The migration chain has no expansion migration.');
    expect(oldMigrations).toHaveLength(30);
    await run(async (sql) => {
      await sql.unsafe(`create database "${SCRATCH}"`);
      created = true;
    }, 'postgres');
    await run(async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      await sql`create schema drizzle`;
      await sql`
        create table drizzle.__drizzle_migrations (
          id serial primary key, hash text not null, created_at bigint
        )
      `;
      for (const migration of oldMigrations) {
        await sql.begin(async (tx) => {
          for (const statement of migration.sql) await tx.unsafe(statement);
          await tx`
            insert into drizzle.__drizzle_migrations (hash, created_at)
            values (${migration.hash}, ${migration.folderMillis})
          `;
        });
      }
      await seedLegacyData(sql);
      await runLegacyHelper(['--existing-credential']);
      initialState = await readBusinessState(sql);
    });
    initialRelease = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
  }, 60_000);

  afterAll(async () => {
    if (!created) return;
    await run((sql) => sql.unsafe(`drop database "${SCRATCH}"`), 'postgres');
  }, 30_000);

  it('upgrades the official old chain without changing business records or credentials', async () => {
    expect(initialRelease).toEqual({
      mode: 'migrated',
      applied: migrations.length - oldMigrations.length,
      total: migrations.length,
    });
    expect(initialState?.issues).toHaveLength(2);
    expect(initialState?.activities).toHaveLength(1);
    expect(initialState?.notifications).toHaveLength(1);
    expect(initialState?.tokens).toHaveLength(1);
    expect(await run(readBusinessState)).toEqual(legacyBusinessState());
    await runLegacyHelper(['--existing-credential']);
    expect(await run(readBusinessState)).toEqual(legacyBusinessState());
    await rolledBack(async (tx) => {
      expect(await readActors(tx, 'history-assigned')).toEqual({
        creator_id: 'expand-creator',
        assignee_id: 'expand-first',
        creator_user_id: 'expand-creator',
        creator_agent_id: null,
        assignee_user_id: 'expand-first',
        assignee_agent_id: null,
        owner_user_id: 'expand-first',
      });
      expect(await readActors(tx, 'history-unassigned')).toMatchObject({
        creator_user_id: 'expand-creator',
        assignee_user_id: null,
        owner_user_id: null,
      });
      const [agents] = await tx<{ count: number }[]>`
        select count(*)::integer as count from agent_identity
      `;
      expect(agents?.count).toBe(0);
    });
  });

  it('installs synchronization before backfill and safely reruns the committed backfill', async () => {
    const statements = expansion?.sql ?? [];
    const functionIndex = statements.findIndex((statement) =>
      /create(?: or replace)? function sync_issue_human_actors/iu.test(statement),
    );
    const triggerIndex = statements.findIndex((statement) =>
      /create trigger issue_human_actor_compat_trigger/iu.test(statement),
    );
    expect(functionIndex).toBeGreaterThanOrEqual(0);
    expect(triggerIndex).toBeGreaterThan(functionIndex);
    expect(statements.indexOf(backfillStatement(expansion))).toBeGreaterThan(triggerIndex);
    await rolledBack(async (tx) => {
      await tx`update issue set assignee_id = 'expand-second' where id = 'history-assigned'`;
      await tx.unsafe(backfillStatement(expansion));
      await tx.unsafe(backfillStatement(expansion));
      expect(await readActors(tx, 'history-assigned')).toMatchObject({
        assignee_id: 'expand-second',
        assignee_user_id: 'expand-second',
        owner_user_id: 'expand-first',
      });
      const [issue] = await tx`
        select sync_id::text as sync_id, updated_at::text as updated_at
        from issue where id = 'history-assigned'
      `;
      expect(issue).toEqual({ sync_id: '710', updated_at: '2026-07-02 02:00:00+00' });
    });
  });

  it('synchronizes old inserts, reassignments and clearing without replacing the owner', async () => {
    await rolledBack(async (tx) => {
      await insertLegacyIssue(tx, 'expand-first');
      expect(await readActors(tx, 'legacy-write')).toEqual({
        creator_id: 'expand-creator',
        assignee_id: 'expand-first',
        creator_user_id: 'expand-creator',
        creator_agent_id: null,
        assignee_user_id: 'expand-first',
        assignee_agent_id: null,
        owner_user_id: 'expand-first',
      });
      await tx`update issue set assignee_id = 'expand-second' where id = 'legacy-write'`;
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        assignee_id: 'expand-second',
        assignee_user_id: 'expand-second',
        assignee_agent_id: null,
        owner_user_id: 'expand-first',
      });
      await tx`update issue set assignee_id = null where id = 'legacy-write'`;
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        assignee_id: null,
        assignee_user_id: null,
        assignee_agent_id: null,
        owner_user_id: 'expand-first',
      });
    });
  });

  it('initializes an empty owner on the first assignment and ignores unrelated updates', async () => {
    await rolledBack(async (tx) => {
      await insertLegacyIssue(tx, null);
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        assignee_user_id: null,
        owner_user_id: null,
      });
      await tx`update issue set assignee_id = 'expand-first' where id = 'legacy-write'`;
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        assignee_user_id: 'expand-first',
        owner_user_id: 'expand-first',
      });
      await tx`update issue set owner_user_id = null where id = 'legacy-write'`;
      await tx`update issue set title = 'Unrelated change' where id = 'legacy-write'`;
      await tx`update issue set assignee_id = assignee_id where id = 'legacy-write'`;
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        assignee_user_id: 'expand-first',
        owner_user_id: null,
      });
      await tx`update issue set assignee_id = 'expand-second' where id = 'legacy-write'`;
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        assignee_user_id: 'expand-second',
        owner_user_id: 'expand-second',
      });
    });
  });

  it('mirrors legacy creator changes', async () => {
    await rolledBack(async (tx) => {
      await tx`update issue set creator_id = 'expand-second' where id = 'history-assigned'`;
      expect(await readActors(tx, 'history-assigned')).toMatchObject({
        creator_id: 'expand-second',
        creator_user_id: 'expand-second',
        creator_agent_id: null,
        owner_user_id: 'expand-first',
      });
    });
  });

  it('allows deleting a former owner without undoing the owner foreign key action', async () => {
    await rolledBack(async (tx) => {
      await tx`update issue set assignee_id = 'expand-second' where id = 'history-assigned'`;
      await tx`delete from "user" where id = 'expand-first'`;
      expect(await readActors(tx, 'history-assigned')).toMatchObject({
        assignee_id: 'expand-second',
        assignee_user_id: 'expand-second',
        owner_user_id: null,
      });
      await tx`update issue set title = 'Owner deleted' where id = 'history-assigned'`;
      expect(await readActors(tx, 'history-assigned')).toMatchObject({ owner_user_id: null });
    });
  });

  it('allows deleting the current assignee with both old and new foreign keys', async () => {
    await rolledBack(async (tx) => {
      await tx`update issue set assignee_id = 'expand-second' where id = 'history-assigned'`;
      await tx`delete from "user" where id = 'expand-second'`;
      expect(await readActors(tx, 'history-assigned')).toMatchObject({
        assignee_id: null,
        assignee_user_id: null,
        owner_user_id: 'expand-first',
      });
    });
    await rolledBack(async (tx) => {
      await tx`delete from "user" where id = 'expand-first'`;
      expect(await readActors(tx, 'history-assigned')).toMatchObject({
        assignee_id: null,
        assignee_user_id: null,
        owner_user_id: null,
      });
    });
  });

  it('keeps the previous compatibility release legacy consent upsert usable', async () => {
    await rolledBack(async (tx) => {
      await tx`
        insert into mcp_grant (id, client_id, user_id, organization_id, scopes)
        values ('replacement-grant', 'expand-client', 'expand-creator', 'expand-org', 'orbit.read')
        on conflict (client_id, user_id) where identity_kind = 'legacy' do update set
          id = excluded.id, scopes = excluded.scopes, revoked_at = null
      `;
      const grants = await tx`
        select id, scopes, revoked_at from mcp_grant
        where client_id = 'expand-client' and user_id = 'expand-creator'
      `;
      expect([...grants]).toEqual([
        { id: 'replacement-grant', scopes: 'orbit.read', revoked_at: null },
      ]);
    });
  });

  it('releases repeatedly with an unchanged ledger, catalog and compatibility trigger', async () => {
    const first = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    const second = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    expect(first).toEqual({ mode: 'current', applied: 0, total: migrations.length });
    expect(second).toEqual(first);
    expect(await run(readBusinessState)).toEqual(legacyBusinessState());
    const ledger = await run(
      (sql) => sql<{ hash: string; created_at: string }[]>`
      select hash, created_at::text as created_at
      from drizzle.__drizzle_migrations order by created_at, id
    `,
    );
    expect([...ledger]).toEqual(
      migrations.map((migration) => ({
        hash: migration.hash,
        created_at: String(migration.folderMillis),
      })),
    );
    const artifacts = await run(
      (sql) => sql<{ enabled: string; kind: number; function_name: string }[]>`
      select trigger.tgenabled as enabled, trigger.tgtype as kind, procedure.proname as function_name
      from pg_trigger trigger
      inner join pg_proc procedure on procedure.oid = trigger.tgfoid
      where trigger.tgrelid = 'public.issue'::regclass
        and trigger.tgname = 'issue_human_actor_compat_trigger'
    `,
    );
    expect([...artifacts]).toEqual([
      { enabled: 'O', kind: 23, function_name: 'sync_issue_human_actors' },
    ]);
    expect(
      isBehind(catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)))),
    ).toBe(false);
    await rolledBack(async (tx) => {
      await insertLegacyIssue(tx, 'expand-first');
      expect(await readActors(tx, 'legacy-write')).toMatchObject({
        creator_user_id: 'expand-creator',
        assignee_user_id: 'expand-first',
        owner_user_id: 'expand-first',
      });
    });
  }, 60_000);

  it('runs compatible issue, starter and legacy MCP services against the upgraded database', async () => {
    await runLegacyHelper();
  }, 30_000);
});
