import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { laneDatabase, laneSuffix } from '../../../scripts/test-env.ts';
import { catalogDriftBetween, expectedCatalog, isBehind, liveCatalog } from '../src/check-drift.ts';
import { prepareTestDatabase } from '../src/prepare-test-database.ts';
import * as schema from '../src/schema/index.ts';
import { ensureLaneDatabase } from '../src/test-lane.ts';

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const DATABASE = `orbit_test_prepare_${Bun.randomUUIDv7().replaceAll('-', '').slice(-12)}`;
const laneNames = new Set<string>();

function urlFor(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function adminUrl(): string {
  return urlFor('postgres');
}

describe('test database preparation', () => {
  beforeAll(async () => {
    const admin = postgres(adminUrl(), { max: 1, prepare: false });
    try {
      await admin.unsafe(`create database "${DATABASE}"`);
    } finally {
      await admin.end();
    }
    await prepareTestDatabase(urlFor(DATABASE));
  }, 60_000);

  afterAll(async () => {
    const admin = postgres(adminUrl(), { max: 1, prepare: false });
    try {
      for (const name of laneNames) {
        await admin.unsafe(`drop database if exists "${name}" with (force)`);
      }
      await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`);
    } finally {
      await admin.end();
    }
  });

  it('retains every declared constraint and the exact conflict arbiters after repeated preparation', async () => {
    await prepareTestDatabase(urlFor(DATABASE));
    const catalog = await liveCatalog(urlFor(DATABASE));
    expect(isBehind(catalogDriftBetween(expectedCatalog(schema), catalog))).toBe(false);

    const sql = postgres(urlFor(DATABASE), { max: 1, prepare: false });
    try {
      const integration = await sql<{ 'QUERY PLAN': string }[]>`
        explain insert into integration (id, organization_id, provider, external_id, connected_by_id)
        values ('probe', 'organization', 'github', 'installation', 'user')
        on conflict (organization_id, provider, external_id) do nothing
      `;
      const subscription = await sql<{ 'QUERY PLAN': string }[]>`
        explain insert into issue_subscription (id, issue_id, user_id)
        values ('probe', 'issue', 'user') on conflict (issue_id, user_id) do nothing
      `;
      expect(integration.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'Conflict Arbiter Indexes: integration_org_provider_unique',
      );
      expect(subscription.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'Conflict Arbiter Indexes: issue_subscription_unique',
      );
    } finally {
      await sql.end();
    }
  }, 60_000);

  it('clones complete catalogs into separate lanes whose writes remain isolated', async () => {
    const savedLane = process.env['ORBIT_TEST_LANE'];
    const urls: string[] = [];
    try {
      for (const suffix of ['first', 'second']) {
        const rawLane = `${savedLane ?? DATABASE}-${suffix}`;
        process.env['ORBIT_TEST_LANE'] = rawLane;
        const name = laneDatabase(DATABASE, laneSuffix(rawLane));
        laneNames.add(name);
        const url = urlFor(name);
        await ensureLaneDatabase(url, DATABASE);
        await ensureLaneDatabase(url, DATABASE);
        expect(isBehind(catalogDriftBetween(expectedCatalog(schema), await liveCatalog(url)))).toBe(
          false,
        );
        urls.push(url);
      }

      const [firstUrl, secondUrl] = urls;
      if (firstUrl === undefined || secondUrl === undefined) {
        throw new Error('Both test lanes must be prepared.');
      }
      const first = postgres(firstUrl, { max: 1, prepare: false });
      const second = postgres(secondUrl, { max: 1, prepare: false });
      try {
        await first`insert into organization (id, name, slug) values ('lane-probe', 'First', 'lane-probe')`;
        expect(await second`select id from organization where id = 'lane-probe'`).toHaveLength(0);
        await second`insert into organization (id, name, slug) values ('lane-probe', 'Second', 'lane-probe')`;
        await second`truncate organization cascade`;
        expect(await first`select name from organization where id = 'lane-probe'`).toMatchObject([
          { name: 'First' },
        ]);
      } finally {
        await first.end();
        await second.end();
      }
    } finally {
      if (savedLane === undefined) Reflect.deleteProperty(process.env, 'ORBIT_TEST_LANE');
      else process.env['ORBIT_TEST_LANE'] = savedLane;
    }
  }, 60_000);

  it('uses release migrations for the complete schema and can be repeated', async () => {
    const sql = postgres(urlFor(DATABASE), { max: 1, prepare: false });
    try {
      const indexes = await sql<{ indexname: string }[]>`
        select indexname from pg_indexes
        where schemaname = 'public'
          and indexname in ('issue_subscription_unique', 'cycle_progress_snapshot_unique')
        order by indexname
      `;
      expect(indexes.map((row) => row.indexname)).toEqual([
        'cycle_progress_snapshot_unique',
        'issue_subscription_unique',
      ]);
    } finally {
      await sql.end();
    }

    await prepareTestDatabase(urlFor(DATABASE));

    const repeated = postgres(urlFor(DATABASE), { max: 1, prepare: false });
    try {
      const indexes = await repeated<{ indexname: string }[]>`
        select indexname from pg_indexes
        where schemaname = 'public'
          and indexname in ('issue_subscription_unique', 'cycle_progress_snapshot_unique')
        order by indexname
      `;
      expect(indexes.map((row) => row.indexname)).toEqual([
        'cycle_progress_snapshot_unique',
        'issue_subscription_unique',
      ]);
    } finally {
      await repeated.end();
    }
  }, 60_000);
});
