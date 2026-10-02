import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';
import { releaseDatabase } from '../../src/migration-release.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_agent_actor_schema', currentLane());
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

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

interface ConstraintRow extends Record<string, unknown> {
  readonly name: string;
  readonly type: string;
  readonly definition: string;
}

async function issueConstraints(): Promise<ConstraintRow[]> {
  return await run(
    urlFor(SCRATCH),
    (sql) => sql<ConstraintRow[]>`
      select conname as name, contype::text as type, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.issue'::regclass and contype in ('c', 'f')
      order by conname
    `,
  );
}

async function issueIndexNames(): Promise<string[]> {
  const rows = await run(
    urlFor(SCRATCH),
    (sql) => sql<{ name: string }[]>`
      select indexname as name from pg_indexes
      where schemaname = 'public' and tablename = 'issue' and indexname like '%assignee%'
      order by indexname
    `,
  );
  return rows.map((row) => row.name);
}

interface ColumnRow extends Record<string, unknown> {
  readonly table_name: string;
  readonly column_name: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
}

async function actorAttributionColumns(): Promise<ColumnRow[]> {
  return await run(
    urlFor(SCRATCH),
    (sql) => sql<ColumnRow[]>`
      select table_name, column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'issue_activity' and column_name in (
            'actor_avatar', 'principal_avatar', 'cause', 'cause_actor_id'
          ))
          or (table_name in ('notification', 'audit_log') and column_name in (
            'actor_avatar', 'principal_avatar'
          ))
        )
      order by table_name, column_name
    `,
  );
}

async function seedActors(): Promise<void> {
  await run(urlFor(SCRATCH), async (sql) => {
    await sql`
      insert into "user" (id, name, email, handle)
      values ('actor-owner', 'Actor Owner', 'actor-owner@example.com', 'actor-owner'),
        ('actor-outsider', 'Actor Outsider', 'actor-outsider@example.com', 'actor-outsider')
    `;
    await sql`
      insert into organization (id, name, slug)
      values ('actor-org', 'Actor workspace', 'actor-workspace'),
        ('actor-org-other', 'Other workspace', 'other-workspace')
    `;
    await sql`
      insert into oauth_application (id, name, client_id, redirect_urls, type)
      values ('actor-client', 'Actor client', 'actor-client-id', 'https://example.com/callback', 'web')
    `;
    await sql`
      insert into agent_identity
        (id, organization_id, owner_user_id, owner_name_snapshot, client_id, client_name_snapshot, name)
      values
        ('actor-agent', 'actor-org', 'actor-owner', 'Actor Owner', 'actor-client-id', 'Actor client', 'Researcher'),
        ('actor-agent-other', 'actor-org-other', 'actor-outsider', 'Actor Outsider', 'actor-client-id', 'Actor client', 'Foreigner')
    `;
    await sql`
      insert into member (id, organization_id, user_id, role)
      values ('actor-member', 'actor-org', 'actor-owner', 'admin')
    `;
    await sql`
      insert into team (id, organization_id, name, key)
      values ('actor-team', 'actor-org', 'Actor team', 'ACTOR')
    `;
    await sql`
      insert into workflow_state (id, organization_id, team_id, name, category, color)
      values ('actor-state', 'actor-org', 'actor-team', 'Todo', 'backlog', '#000000')
    `;
  });
}

let counter = 0;

async function insertIssue(columns: string, values: string): Promise<void> {
  counter += 1;
  const statement = `insert into issue (id, organization_id, team_id, number, identifier, title, state_id, ${columns}) values ('probe-${String(counter)}', 'actor-org', 'actor-team', ${String(counter)}, 'ACTOR-${String(counter)}', 'Probe', 'actor-state', ${values})`;
  await run(urlFor(SCRATCH), (sql) => sql.unsafe(statement));
}

describe('issue agent actor schema', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create extension if not exists pg_trgm`;
    });
    await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    await seedActors();
  }, 60_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('P0-DB-1 declares the creator, assignee and owner checks and the two composite agent foreign keys', async () => {
    const constraints = await issueConstraints();
    const byName = new Map(constraints.map((row) => [row.name, row]));

    expect(byName.get('issue_creator_actor_check')?.type).toBe('c');
    expect(byName.get('issue_creator_actor_check')?.definition).toContain('creator_user_id');
    expect(byName.get('issue_assignee_actor_check')?.type).toBe('c');
    expect(byName.get('issue_agent_assignee_owner_check')?.type).toBe('c');
    expect(byName.get('issue_agent_assignee_owner_check')?.definition).toContain('owner_user_id');

    expect(byName.get('issue_organization_creator_agent_fk')?.type).toBe('f');
    expect(byName.get('issue_organization_creator_agent_fk')?.definition).toContain(
      'agent_identity(organization_id, id)',
    );
    expect(byName.get('issue_organization_assignee_agent_fk')?.type).toBe('f');
    expect(byName.get('issue_organization_assignee_agent_fk')?.definition).toContain(
      'agent_identity(organization_id, id)',
    );
  });

  it('P0-DB-1 indexes both human and agent assignee lookups', async () => {
    const names = await issueIndexNames();
    expect(names).toContain('issue_assignee_user_idx');
    expect(names).toContain('issue_assignee_agent_idx');
    expect(names).toContain('issue_assignee_idx');
  });

  it('P0-DB-1 rejects a creator that is neither or both actors', async () => {
    await expect(
      insertIssue('creator_id, creator_user_id, creator_agent_id', "'actor-owner', null, null"),
    ).rejects.toThrow('issue_creator_actor_check');
    await expect(
      insertIssue(
        'creator_id, creator_user_id, creator_agent_id',
        "'actor-owner', 'actor-owner', 'actor-agent'",
      ),
    ).rejects.toThrow('issue_creator_actor_check');
  });

  it('P0-DB-1 rejects two assignee actors and an agent assignee without a human owner', async () => {
    await expect(
      insertIssue(
        'creator_id, creator_user_id, assignee_user_id, assignee_agent_id, owner_user_id',
        "'actor-owner', 'actor-owner', 'actor-owner', 'actor-agent', 'actor-owner'",
      ),
    ).rejects.toThrow('issue_assignee_actor_check');

    await expect(
      insertIssue(
        'creator_id, creator_user_id, assignee_agent_id',
        "'actor-owner', 'actor-owner', 'actor-agent'",
      ),
    ).rejects.toThrow('issue_agent_assignee_owner_check');
  });

  it('P0-DB-1 rejects an agent actor from another workspace', async () => {
    await expect(
      insertIssue(
        'creator_id, creator_user_id, creator_agent_id',
        "'actor-owner', null, 'actor-agent-other'",
      ),
    ).rejects.toThrow('issue_organization_creator_agent_fk');

    await expect(
      insertIssue(
        'creator_id, creator_user_id, assignee_agent_id, owner_user_id',
        "'actor-owner', 'actor-owner', 'actor-agent-other', 'actor-owner'",
      ),
    ).rejects.toThrow('issue_organization_assignee_agent_fk');
  });

  it('P0-DB-1 admits a same workspace agent creator and a same workspace agent assignee with an owner', async () => {
    await insertIssue('creator_id, creator_user_id, creator_agent_id', "null, null, 'actor-agent'");
    await insertIssue(
      'creator_id, creator_user_id, creator_agent_id',
      "'actor-owner', null, 'actor-agent'",
    );
    await insertIssue(
      'creator_id, creator_user_id, assignee_agent_id, owner_user_id',
      "'actor-owner', 'actor-owner', 'actor-agent', 'actor-owner'",
    );
    const rows = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ count: string }[]>`select count(*)::text as count from issue`,
    );
    expect(rows[0]?.count).toBe('3');
  });

  it('P0-DB-1 adds nullable actor snapshot columns without defaults', async () => {
    const rows = await actorAttributionColumns();
    const byKey = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
    const expected = [
      'issue_activity.actor_avatar',
      'issue_activity.principal_avatar',
      'issue_activity.cause',
      'issue_activity.cause_actor_id',
      'notification.actor_avatar',
      'notification.principal_avatar',
      'audit_log.actor_avatar',
      'audit_log.principal_avatar',
    ];
    expect(rows).toHaveLength(expected.length);
    for (const key of expected) {
      const row = byKey.get(key);
      expect(row).toBeDefined();
      expect(row?.is_nullable).toBe('YES');
      expect(row?.column_default).toBeNull();
    }
  });
});
