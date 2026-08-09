import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { resolveExactTestDatabaseUrl } from '../../../scripts/test-env.ts';
import { applyCatchup, catchupPath, targetName } from '../src/apply-catchup.ts';
import { ensureLaneDatabase } from '../src/test-lane.ts';

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

const SCRATCH_URL = resolveExactTestDatabaseUrl('orbit_test_catchup');

async function run<T>(url: string, work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    return await work(sql);
  } finally {
    await sql.end();
  }
}

describe('applyCatchup against a real database', () => {
  beforeAll(async () => {
    await ensureLaneDatabase(SCRATCH_URL, 'orbit_test_catchup');
    await run(SCRATCH_URL, async (sql) => {
      await sql
        .unsafe(`
        drop schema if exists public cascade;
        create schema public;
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
    await run(SCRATCH_URL, (sql) =>
      sql.unsafe('drop schema if exists public cascade; create schema public;').simple(),
    );
  }, 30_000);

  it('adds what the doc tree needs, and is clean on a second run', async () => {
    await applyCatchup(SCRATCH_URL, 'doc-tree-schema-catchup.sql');
    await applyCatchup(SCRATCH_URL, 'doc-tree-schema-catchup.sql');

    const columns = await run(
      SCRATCH_URL,
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
      SCRATCH_URL,
      (sql) =>
        sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = 'doc_access_request'
      `,
    );
    expect(tables).toHaveLength(1);
  }, 30_000);

  it('indexes a doc body once the search vector exists', async () => {
    await applyCatchup(SCRATCH_URL, 'doc-tree-schema-catchup.sql');

    const [row] = await run(SCRATCH_URL, async (sql) => {
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
    await expect(applyCatchup(SCRATCH_URL, '/etc/passwd.sql')).rejects.toThrow();
  });
});
