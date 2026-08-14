import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
import { applyCatchup, catchupPath, targetName } from '../src/apply-catchup.ts';

describe('catchupPath', () => {
  it('resolves a script by name inside the catchup directory', () => {
    expect(catchupPath('doc-tree-schema-catchup.sql')).toEndWith(
      '/catchup/doc-tree-schema-catchup.sql',
    );
  });

  it('accepts the repository relative path the runbook prints', () => {
    expect(catchupPath('packages/db/catchup/doc-tree-order-catchup.sql')).toEndWith(
      '/catchup/doc-tree-order-catchup.sql',
    );
  });

  it('refuses a file outside the catchup directory', () => {
    expect(() => catchupPath('../../../etc/passwd.sql')).toThrow();
    expect(() => catchupPath('/tmp/anything.sql')).toThrow();
  });

  it('refuses a file that is not sql', () => {
    expect(() => catchupPath('notes.md')).toThrow();
  });
});

describe('targetName', () => {
  it('names a database without carrying its credentials', () => {
    const named = targetName('postgres://someone:hunter2@db.example.com:5432/orbit');
    expect(named).toBe('db.example.com/orbit');
    expect(named).not.toContain('hunter2');
  });

  it('says something sensible for a url it cannot parse', () => {
    expect(targetName('not a url')).toBe('the configured database');
  });
});

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_catchup', currentLane());

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

async function applyWorkspaceSprintMigration(url: string): Promise<void> {
  const migration = await readFile(
    new URL('../drizzle/0007_faulty_skaar.sql', import.meta.url),
    'utf8',
  );
  await run(url, async (sql) => {
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim().length > 0) await sql.unsafe(statement);
    }
  });
}

describe('applyCatchup against a real database', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), async (sql) => {
      await sql
        .unsafe(`
        create table public."user" (id text primary key);
        create table public.organization (
          id text primary key,
          allowed_email_domains jsonb not null default '[]'::jsonb
        );
        create table public.doc (
          id text primary key,
          organization_id text not null references public.organization(id),
          collection_id text,
          title text not null default '',
          content text not null default ''
        );
        create table public.doc_collection (
          id text primary key,
          organization_id text not null references public.organization(id)
        );
        create index doc_collection_org_idx on public.doc_collection (organization_id);
        create type public.notification_reason as enum ('mentioned', 'manual');
      `)
        .simple();
    });
  }, 30_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('adds what the doc tree needs, and is clean on a second run', async () => {
    await applyCatchup(urlFor(SCRATCH), 'doc-tree-schema-catchup.sql');
    await applyCatchup(urlFor(SCRATCH), 'doc-tree-schema-catchup.sql');

    const columns = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql<{ column_name: string; is_generated: string }[]>`
        select column_name, is_generated from information_schema.columns
        where table_schema = 'public' and table_name = 'doc'
      `,
    );
    const named = new Map(columns.map((row) => [row.column_name, row.is_generated]));
    expect(named.has('sort_order')).toBe(true);
    expect(named.has('slug')).toBe(true);
    expect(named.get('search_vector')).toBe('ALWAYS');

    const tables = await run(
      urlFor(SCRATCH),
      (sql) =>
        sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = 'doc_access_request'
      `,
    );
    expect(tables).toHaveLength(1);
  }, 30_000);

  it('indexes a doc body once the search vector exists', async () => {
    await applyCatchup(urlFor(SCRATCH), 'doc-tree-schema-catchup.sql');

    const [row] = await run(urlFor(SCRATCH), async (sql) => {
      await sql`insert into public.organization (id) values ('org-1') on conflict do nothing`;
      await sql`
        insert into public.doc (id, organization_id, title, content)
        values ('doc-1', 'org-1', 'Realtime delta protocol', 'the hub fans a delta out')
        on conflict (id) do update set content = excluded.content
      `;
      return await sql<{ hit: boolean }[]>`
        select search_vector @@ to_tsquery('english', 'delta') as hit
        from public.doc where id = 'doc-1'
      `;
    });
    expect(row?.hit).toBe(true);
  }, 30_000);

  it('refuses a file outside the catchup directory before it opens anything', async () => {
    await expect(applyCatchup(urlFor(SCRATCH), '/etc/passwd.sql')).rejects.toThrow();
  });
});

const SPRINT_SCRATCH = laneDatabase('orbit_test_workspace_sprint_catchup', currentLane());

describe('workspace sprint catchup against captured analytics', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SPRINT_SCRATCH}"`);
      await sql.unsafe(`create database "${SPRINT_SCRATCH}"`);
    });
    await run(urlFor(SPRINT_SCRATCH), async (sql) => {
      await sql
        .unsafe(`
        create table public.organization (id text primary key);
        create table public.team (
          id text primary key,
          organization_id text not null references public.organization(id)
        );
        create table public.cycle (
          id text primary key,
          organization_id text not null references public.organization(id),
          team_id text not null references public.team(id) on delete cascade,
          number integer not null,
          starts_at timestamptz not null,
          ends_at timestamptz not null,
          completed_at timestamptz,
          archived_at timestamptz,
          created_at timestamptz not null default now()
        );
        create unique index cycle_team_number_unique on public.cycle (team_id, number);
        create index cycle_team_dates_idx on public.cycle (team_id, starts_at);
        create table public.issue (
          id text primary key,
          organization_id text not null references public.organization(id),
          team_id text not null references public.team(id),
          cycle_id text references public.cycle(id),
          identifier text not null,
          estimate integer,
          assignee_id text,
          project_id text,
          milestone_id text,
          archived_at timestamptz
        );
        create table public.cycle_issue_membership (
          id text primary key,
          organization_id text not null,
          team_id text not null,
          cycle_id text not null references public.cycle(id) on delete cascade,
          issue_id text not null,
          issue_identifier text not null,
          added_at timestamptz not null,
          removed_at timestamptz,
          entry_kind text not null,
          estimate_at_add integer,
          assignee_id_at_add text,
          project_id_at_add text,
          milestone_id_at_add text,
          coverage text not null default 'captured',
          created_at timestamptz not null default now()
        );
        create unique index cycle_issue_membership_one_open_per_issue_unique
          on public.cycle_issue_membership (issue_id) where removed_at is null;
        insert into public.organization (id) values ('org');
        insert into public.team (id, organization_id) values ('team-a', 'org'), ('team-b', 'org');
        insert into public.cycle
          (id, organization_id, team_id, number, starts_at, ends_at, created_at)
        values
          ('source', 'org', 'team-a', 1, '2026-01-01', '2026-01-15', '2026-01-01'),
          ('winner', 'org', 'team-b', 1, '2026-01-01', '2026-01-15', '2026-01-02');
        insert into public.issue
          (id, organization_id, team_id, cycle_id, identifier)
        values
          ('moved', 'org', 'team-a', 'source', 'A-1'),
          ('kept-1', 'org', 'team-b', 'winner', 'B-1'),
          ('kept-2', 'org', 'team-b', 'winner', 'B-2');
        insert into public.cycle_issue_membership
          (id, organization_id, team_id, cycle_id, issue_id, issue_identifier, added_at, entry_kind)
        values
          ('membership-source', 'org', 'team-a', 'source', 'moved', 'A-1', '2026-01-01', 'added');
      `)
        .simple();
    });
  }, 30_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) =>
      sql.unsafe(`drop database if exists "${SPRINT_SCRATCH}"`),
    );
  }, 30_000);

  it('reconciles captured membership when it moves an issue to the winning sprint', async () => {
    await applyWorkspaceSprintMigration(urlFor(SPRINT_SCRATCH));
    await applyCatchup(urlFor(SPRINT_SCRATCH), 'workspace-sprints-catchup.sql');
    await applyWorkspaceSprintMigration(urlFor(SPRINT_SCRATCH));

    const rows = await run(
      urlFor(SPRINT_SCRATCH),
      (sql) => sql<{ cycle_id: string; removed_at: Date | null }[]>`
        select cycle_id, removed_at from public.cycle_issue_membership
        where issue_id = 'moved' order by added_at, cycle_id
      `,
    );
    const assigned = await run(
      urlFor(SPRINT_SCRATCH),
      (sql) => sql<{ cycle_id: string | null }[]>`
        select cycle_id from public.issue where id = 'moved'
      `,
    );

    expect(assigned[0]?.cycle_id).toBe('winner');
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.cycle_id === 'source')?.removed_at).not.toBeNull();
    expect(rows.find((row) => row.cycle_id === 'winner')?.removed_at).toBeNull();
  }, 30_000);
});

const ANALYTICS_SCRATCH = laneDatabase('orbit_test_analytics_catchup', currentLane());

describe('analytics planning catchup against a deployed schema', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${ANALYTICS_SCRATCH}"`);
      await sql.unsafe(`create database "${ANALYTICS_SCRATCH}"`);
    });
    await run(urlFor(ANALYTICS_SCRATCH), async (sql) => {
      await sql
        .unsafe(`
        create table public.organization (id text primary key);
        create table public.team (
          id text primary key,
          organization_id text not null references public.organization(id)
        );
        create table public."user" (id text primary key);
        create table public.project (id text primary key);
        create table public.milestone (id text primary key);
        create table public.cycle (id text primary key);
        create table public.cycle_progress_snapshot (
          id text primary key,
          organization_id text not null references public.organization(id),
          cycle_id text not null references public.cycle(id),
          captured_on date not null,
          total_issues integer not null default 0,
          backlog_issues integer not null default 0,
          unstarted_issues integer not null default 0,
          started_issues integer not null default 0,
          completed_issues integer not null default 0,
          canceled_issues integer not null default 0,
          total_estimate double precision not null default 0,
          completed_estimate double precision not null default 0,
          breakdown jsonb not null default '{}'::jsonb,
          sync_id bigint not null default 0,
          created_at timestamptz not null default now(),
          unique (cycle_id, captured_on)
        );
        create table public.issue_activity (
          id text primary key,
          organization_id text not null,
          issue_id text not null,
          field text not null,
          created_at timestamptz not null
        );
        create table public.github_pull_request (id text primary key);
        create table public.git_link (
          id text primary key,
          pull_request_id text references public.github_pull_request(id) on delete set null
        );
        create table public.standup (id text primary key);
        insert into public.organization (id) values ('org');
        insert into public.team (id, organization_id) values ('team', 'org');
        insert into public."user" (id) values ('user');
        insert into public.project (id) values ('project');
        insert into public.milestone (id) values ('milestone');
        insert into public.cycle (id) values ('cycle');
        insert into public.cycle_progress_snapshot
          (id, organization_id, cycle_id, captured_on)
        values ('snapshot', 'org', 'cycle', '2026-08-14');
        insert into public.github_pull_request (id) values ('pull-request');
        insert into public.git_link (id, pull_request_id) values ('link', 'pull-request');
        insert into public.standup (id) values ('standup');
      `)
        .simple();
    });
  }, 30_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) =>
      sql.unsafe(`drop database if exists "${ANALYTICS_SCRATCH}"`),
    );
  }, 30_000);

  it('adds analytics history without replacing unrelated deployed data', async () => {
    await applyCatchup(urlFor(ANALYTICS_SCRATCH), 'analytics-planning-cockpit.sql');
    await applyCatchup(urlFor(ANALYTICS_SCRATCH), 'analytics-planning-cockpit.sql');

    const [objects] = await run(
      urlFor(ANALYTICS_SCRATCH),
      (sql) => sql<
        {
          memberships: string | null;
          outcomes: string | null;
          captured_at: boolean;
          is_final: boolean;
          github_rows: number;
          standup_rows: number;
          linked_rows: number;
        }[]
      >`
        select
          to_regclass('public.cycle_issue_membership')::text as memberships,
          to_regclass('public.cycle_issue_outcome')::text as outcomes,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'cycle_progress_snapshot'
              and column_name = 'captured_at'
              and is_nullable = 'NO'
          ) as captured_at,
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'cycle_progress_snapshot'
              and column_name = 'is_final'
              and is_nullable = 'NO'
          ) as is_final,
          (select count(*)::integer from public.github_pull_request) as github_rows,
          (select count(*)::integer from public.standup) as standup_rows,
          (select count(*)::integer from public.git_link where pull_request_id = 'pull-request') as linked_rows
      `,
    );

    expect(objects).toEqual({
      memberships: 'cycle_issue_membership',
      outcomes: 'cycle_issue_outcome',
      captured_at: true,
      is_final: true,
      github_rows: 1,
      standup_rows: 1,
      linked_rows: 1,
    });

    const indexes = await run(
      urlFor(ANALYTICS_SCRATCH),
      (sql) => sql<{ indexname: string }[]>`
        select indexname from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'cycle_issue_membership_cycle_added_idx',
            'cycle_issue_membership_cycle_removed_idx',
            'cycle_issue_membership_issue_added_idx',
            'cycle_issue_membership_one_open_per_issue_unique',
            'cycle_issue_outcome_cycle_issue_unique',
            'cycle_issue_outcome_cycle_outcome_idx',
            'cycle_issue_outcome_completion_attribution_idx',
            'issue_activity_assignee_attribution_idx'
          )
        order by indexname
      `,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'cycle_issue_membership_cycle_added_idx',
      'cycle_issue_membership_cycle_removed_idx',
      'cycle_issue_membership_issue_added_idx',
      'cycle_issue_membership_one_open_per_issue_unique',
      'cycle_issue_outcome_completion_attribution_idx',
      'cycle_issue_outcome_cycle_issue_unique',
      'cycle_issue_outcome_cycle_outcome_idx',
      'issue_activity_assignee_attribution_idx',
    ]);

    const [snapshot] = await run(
      urlFor(ANALYTICS_SCRATCH),
      (sql) => sql<{ id: string; captured_at: Date; is_final: boolean }[]>`
        select id, captured_at, is_final
        from public.cycle_progress_snapshot
        where id = 'snapshot'
      `,
    );
    expect(snapshot?.id).toBe('snapshot');
    expect(snapshot?.captured_at).toBeInstanceOf(Date);
    expect(snapshot?.is_final).toBe(false);
  }, 30_000);
});
