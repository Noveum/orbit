import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_workspace_sprint_migrations', currentLane());
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

describe('workspace sprint migration', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS });
    });
  }, 30_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('installs the nullable workspace sprint ownership and organization indexes', async () => {
    const [column] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'cycle' and column_name = 'team_id'
      `,
    );
    const [foreignKey] = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ delete_rule: string }[]>`
        select delete_rule from information_schema.referential_constraints
        where constraint_schema = 'public'
          and constraint_name = 'cycle_team_id_team_id_fk'
      `,
    );
    const indexes = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'cycle'
      `,
    );
    const named = new Map(indexes.map((row) => [row.indexname, row.indexdef]));

    expect(column?.is_nullable).toBe('YES');
    expect(foreignKey?.delete_rule).toBe('SET NULL');
    expect(named.get('cycle_org_number_unique')).toContain(
      'UNIQUE INDEX cycle_org_number_unique ON public.cycle USING btree (organization_id, number)',
    );
    expect(named.get('cycle_org_dates_idx')).toContain(
      'INDEX cycle_org_dates_idx ON public.cycle USING btree (organization_id, starts_at)',
    );
    expect(named.has('cycle_team_number_unique')).toBe(false);
    expect(named.has('cycle_team_dates_idx')).toBe(false);
  });

  it('accepts a sprint with no team after a migration-only install', async () => {
    const [created] = await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        insert into public.organization (id, name, slug)
        values ('migration-org', 'Migration workspace', 'migration-workspace')
      `;
      return await sql<{ team_id: string | null }[]>`
        insert into public.cycle
          (id, organization_id, number, starts_at, ends_at)
        values
          ('migration-cycle', 'migration-org', 1, '2026-08-01', '2026-08-15')
        returning team_id
      `;
    });

    expect(created?.team_id).toBeNull();
  });

  it('installs people attribution indexes from migrations', async () => {
    const indexes = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes
        where schemaname = 'public'
          and indexname in (
            'cycle_issue_outcome_completion_attribution_idx',
            'issue_activity_assignee_attribution_idx'
          )
      `,
    );
    const named = new Map(indexes.map((row) => [row.indexname, row.indexdef]));
    expect(named.get('cycle_issue_outcome_completion_attribution_idx')).toContain(
      '(organization_id, issue_id, completed_at, closed_at)',
    );
    expect(named.get('cycle_issue_outcome_completion_attribution_idx')).toContain(
      "WHERE (outcome = 'completed'::text)",
    );
    expect(named.get('issue_activity_assignee_attribution_idx')).toContain(
      '(organization_id, issue_id, created_at)',
    );
    expect(named.get('issue_activity_assignee_attribution_idx')).toContain(
      "WHERE (field = 'assigneeId'::text)",
    );
  });
});
