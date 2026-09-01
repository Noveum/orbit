import { afterAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_github_head_bootstrap', currentLane());
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

describe('GitHub check head migration bootstrap', () => {
  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('queues each distinct active pull head when the authoritative tables are introduced', async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const taskMigration = migrations.at(-1);
    if (taskMigration === undefined) throw new Error('Task migration is missing.');
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      for (const migration of migrations.slice(0, -1)) {
        for (const statement of migration.sql) await sql.unsafe(statement);
      }
      await sql`insert into "user" (id, name, email, handle) values ('user-1', 'User', 'user@example.com', 'user')`;
      await sql`insert into organization (id, name, slug) values ('org-1', 'Org', 'org')`;
      await sql`
        insert into integration (id, organization_id, provider, external_id, connected_by_id)
        values ('integration-1', 'org-1', 'github', 'installation-1', 'user-1')
      `;
      await sql`
        insert into github_repository_sync (
          id, organization_id, integration_id, repository_id, repository_name, installation_id
        ) values ('repo-1', 'org-1', 'integration-1', '99', 'acme/web', 'installation-1')
      `;
      await sql`
        insert into github_pull_request (
          id, organization_id, repository_sync_id, repository_id, repository_name,
          number, url, head_sha, state, merged
        ) values
          (
            'pull-open-1', 'org-1', 'repo-1', '99', 'acme/web', 1,
            'https://github.com/acme/web/pull/1',
            '0123456789abcdef0123456789abcdef01234567', 'open', false
          ),
          (
            'pull-open-2', 'org-1', 'repo-1', '99', 'acme/web', 2,
            'https://github.com/acme/web/pull/2',
            '0123456789abcdef0123456789abcdef01234567', 'open', false
          ),
          (
            'pull-draft', 'org-1', 'repo-1', '99', 'acme/web', 3,
            'https://github.com/acme/web/pull/3',
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'draft', false
          ),
          (
            'pull-approved', 'org-1', 'repo-1', '99', 'acme/web', 4,
            'https://github.com/acme/web/pull/4',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'approved', false
          ),
          (
            'pull-changes', 'org-1', 'repo-1', '99', 'acme/web', 5,
            'https://github.com/acme/web/pull/5',
            'cccccccccccccccccccccccccccccccccccccccc', 'changes_requested', false
          ),
          (
            'pull-closed', 'org-1', 'repo-1', '99', 'acme/web', 6,
            'https://github.com/acme/web/pull/6',
            'dddddddddddddddddddddddddddddddddddddddd', 'closed', false
          ),
          (
            'pull-merged', 'org-1', 'repo-1', '99', 'acme/web', 7,
            'https://github.com/acme/web/pull/7',
            'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'merged', true
          )
      `;
      for (const statement of taskMigration.sql) await sql.unsafe(statement);
    });

    const rows = await run(
      urlFor(SCRATCH),
      (sql) => sql<{ head_sha: string; status: string; trigger_kind: string; attempts: number }[]>`
        select head_sha, status, trigger_kind, attempts
        from github_check_head_reconciliation
        order by head_sha
      `,
    );
    expect([...rows]).toEqual([
      {
        head_sha: '0123456789abcdef0123456789abcdef01234567',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
      {
        head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
      {
        head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
      {
        head_sha: 'cccccccccccccccccccccccccccccccccccccccc',
        status: 'pending',
        trigger_kind: 'migration_bootstrap',
        attempts: 0,
      },
    ]);
  }, 60_000);
});
