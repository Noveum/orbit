import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../scripts/test-env.ts';
import {
  catalogDriftBetween,
  expectedCatalog,
  isBehind,
  liveCatalog,
  normalizeCatalogExpression,
} from '../src/check-drift.ts';
import * as schema from '../src/schema/index.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_catalog_drift', currentLane());
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

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

describe('catalog drift', () => {
  beforeAll(async () => {
    await run(urlFor('postgres'), async (sql) => {
      await sql.unsafe(`drop database if exists "${SCRATCH}"`);
      await sql.unsafe(`create database "${SCRATCH}"`);
    });
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create extension if not exists pg_trgm`;
      await migrate(drizzle({ client: sql }), { migrationsFolder: MIGRATIONS });
    });
  }, 60_000);

  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('matches a database created entirely from committed migrations', async () => {
    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(isBehind(drift)).toBe(false);
  });

  it('strips only parentheses that enclose the complete expression', () => {
    expect(normalizeCatalogExpression('((a) || (b))')).toBe('(a) || (b)');
    expect(normalizeCatalogExpression('(a) || (b)')).toBe('(a) || (b)');
    expect(normalizeCatalogExpression("('(') || (b)")).toBe("('(') || (b)");
  });

  it('accepts equivalent foreign keys created under legacy names', async () => {
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`
        alter table view_preference
        rename constraint view_preference_organization_id_organization_id_fk
        to view_preference_organization_id_fkey
      `;
      await sql`
        alter table view_preference
        rename constraint view_preference_user_id_user_id_fk
        to view_preference_user_id_fkey
      `;
    });

    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(drift.missingForeignKeys).toEqual([]);
    expect(isBehind(drift)).toBe(false);
  });

  it('accepts equivalent indexes created under legacy names', async () => {
    await run(
      urlFor(SCRATCH),
      (sql) => sql`alter index cycle_org_dates_idx rename to legacy_cycle_org_dates_idx`,
    );

    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(drift.missingIndexes).toEqual([]);
    expect(drift.undeclaredIndexes).not.toContainEqual({
      table: 'cycle',
      index: 'legacy_cycle_org_dates_idx',
    });
    expect(isBehind(drift)).toBe(false);
  });

  it('reports undeclared tables and their catalog objects without treating them as behind', async () => {
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`create table legacy_sidecar (id text primary key, organization_id text)`;
      await sql`create index legacy_sidecar_org_idx on legacy_sidecar (organization_id)`;
      await sql`
        alter table legacy_sidecar add constraint legacy_sidecar_org_fk
        foreign key (organization_id) references organization(id)
      `;
    });

    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(drift.undeclaredTables).toContain('legacy_sidecar');
    expect(drift.undeclaredIndexes).toContainEqual({
      table: 'legacy_sidecar',
      index: 'legacy_sidecar_org_idx',
    });
    expect(drift.undeclaredForeignKeys).toContainEqual({
      table: 'legacy_sidecar',
      foreignKey: 'legacy_sidecar_org_fk',
    });
    expect(isBehind(drift)).toBe(false);
  });

  it('detects nullability, foreign key, and index drift even when names and columns exist', async () => {
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`alter table cycle alter column team_id set not null`;
      await sql`alter table cycle drop constraint cycle_team_id_team_id_fk`;
      await sql`
        alter table cycle add constraint cycle_team_id_team_id_fk
        foreign key (team_id) references team(id) on delete cascade
      `;
      await sql`drop index legacy_cycle_org_dates_idx`;
    });

    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(drift.columnMismatches).toContainEqual({
      table: 'cycle',
      column: 'team_id',
      property: 'nullability',
      expected: 'nullable',
      actual: 'not null',
    });
    expect(drift.foreignKeyMismatches.map((entry) => entry.name)).toContain(
      'cycle_team_id_team_id_fk',
    );
    expect(drift.missingIndexes).toContainEqual({ table: 'cycle', index: 'cycle_org_dates_idx' });
    expect(isBehind(drift)).toBe(true);
  });

  it('detects changed default and generated expressions', async () => {
    await run(urlFor(SCRATCH), async (sql) => {
      await sql`alter table cycle alter column timezone set default 'utc'`;
      await sql`alter table doc drop column search_vector`;
      await sql`
        alter table doc add column search_vector tsvector
        generated always as (
          setweight(to_tsvector('english', coalesce(title, '')), 'a') ||
          setweight(to_tsvector('english', left(coalesce(content, ''), 200000)), 'B')
        ) stored
      `;
    });

    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(drift.columnMismatches).toContainEqual({
      table: 'cycle',
      column: 'timezone',
      property: 'default',
      expected: "'UTC'",
      actual: "'utc'",
    });
    expect(drift.columnMismatches).toContainEqual({
      table: 'doc',
      column: 'search_vector',
      property: 'generated',
      expected:
        "setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', left(coalesce(content, ''), 200000)), 'B')",
      actual:
        "setweight(to_tsvector('english', coalesce(title, '')), 'a') || setweight(to_tsvector('english', left(coalesce(content, ''), 200000)), 'B')",
    });
    expect(isBehind(drift)).toBe(true);
  });

  it('detects enum drift', async () => {
    await run(
      urlFor(SCRATCH),
      (sql) => sql`alter type notification_reason add value if not exists 'legacy_reason'`,
    );

    const drift = catalogDriftBetween(expectedCatalog(schema), await liveCatalog(urlFor(SCRATCH)));
    expect(drift.enumMismatches.map((entry) => entry.name)).toContain('notification_reason');
    expect(isBehind(drift)).toBe(true);
  });
});
