import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';
import { releaseDatabase } from '../../src/migration-release.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_project_health_migration', currentLane());
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

describe('project health migration', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), (sql) => sql`create extension if not exists pg_trgm`);
  });

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) =>
      sql.unsafe(`drop database if exists "${SCRATCH}" with (force)`),
    );
  });

  it('normalises legacy health values before adding check constraints', async () => {
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const previous = migrations.filter(
      (entry) => !entry.sql.some((s) => s.includes('project_health_check')),
    );
    const migration0017 = migrations.find((entry) =>
      entry.sql.some((s) => s.includes('project_health_check')),
    );
    if (migration0017 === undefined) throw new Error('project health migration not found');

    await run(urlFor(SCRATCH), async (sql) => {
      for (const entry of previous) {
        for (const statement of entry.sql) {
          await sql.unsafe(statement);
        }
      }

      await sql`
        insert into public.organization (id, name, slug)
        values ('org-legacy', 'Legacy Org', 'legacy-org')
      `;
      await sql`
        insert into public."user" (id, name, email, handle)
        values ('user-legacy', 'Author', 'author@legacy.org', 'author-legacy')
      `;
      await sql`
        insert into public.project (id, organization_id, name, slug, health)
        values ('proj-legacy', 'org-legacy', 'Legacy Project', 'legacy-project', 'legacy_bad_health')
      `;
      await sql`
        insert into public.project_update (id, organization_id, project_id, author_id, health, body)
        values ('update-legacy', 'org-legacy', 'proj-legacy', 'user-legacy', 'legacy_bad_health', 'Legacy update')
      `;

      for (const statement of migration0017.sql) {
        await sql.unsafe(statement);
      }

      const [proj] = await sql<{ health: string }[]>`
        select health from public.project where id = 'proj-legacy'
      `;
      const [update] = await sql<{ health: string }[]>`
        select health from public.project_update where id = 'update-legacy'
      `;

      expect(proj?.health).toBe('no_update');
      expect(update?.health).toBe('no_update');

      let insertFailed = false;
      try {
        await sql`
          insert into public.project (id, organization_id, name, slug, health)
          values ('proj-invalid', 'org-legacy', 'Invalid Project', 'invalid-project', 'invalid_health')
        `;
      } catch {
        insertFailed = true;
      }
      expect(insertFailed).toBe(true);
    });
  });

  it('creates health check constraints during releaseDatabase when baselining a legacy database', async () => {
    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS });
    const previous = migrations.filter(
      (entry) => !entry.sql.some((s) => s.includes('project_health_check')),
    );

    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), (sql) => sql`create extension if not exists pg_trgm`);

    await run(urlFor(SCRATCH), async (sql) => {
      for (const entry of previous) {
        for (const statement of entry.sql) {
          await sql.unsafe(statement);
        }
      }

      await sql`
        insert into public.organization (id, name, slug)
        values ('org-baseline', 'Baseline Org', 'baseline-org')
      `;
      await sql`
        insert into public."user" (id, name, email, handle)
        values ('user-baseline', 'Author', 'baseline@legacy.org', 'baseline-author')
      `;
      await sql`
        insert into public.project (id, organization_id, name, slug, health)
        values ('proj-baseline', 'org-baseline', 'Baseline Project', 'baseline-project', 'legacy_bad_health')
      `;
      await sql`
        insert into public.project_update (id, organization_id, project_id, author_id, health, body)
        values ('update-baseline', 'org-baseline', 'proj-baseline', 'user-baseline', 'legacy_bad_health', 'Legacy update')
      `;
      await sql`drop schema if exists drizzle cascade`;
    });

    const result = await releaseDatabase(urlFor(SCRATCH), MIGRATIONS);
    expect(result.mode).toBe('baselined');

    await run(urlFor(SCRATCH), async (sql) => {
      const [proj] = await sql<{ health: string }[]>`
        select health from public.project where id = 'proj-baseline'
      `;
      const [update] = await sql<{ health: string }[]>`
        select health from public.project_update where id = 'update-baseline'
      `;

      expect(proj?.health).toBe('no_update');
      expect(update?.health).toBe('no_update');

      let insertFailed = false;
      try {
        await sql`
          insert into public.project (id, organization_id, name, slug, health)
          values ('proj-invalid-2', 'org-baseline', 'Invalid Project 2', 'invalid-project-2', 'invalid_health')
        `;
      } catch {
        insertFailed = true;
      }
      expect(insertFailed).toBe(true);
    });
  });
});
