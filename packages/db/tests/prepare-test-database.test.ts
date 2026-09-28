import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { prepareTestDatabase } from '../src/prepare-test-database.ts';

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const DATABASE = `orbit_test_prepare_${Bun.randomUUIDv7().replaceAll('-', '')}`;

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
      await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`);
    } finally {
      await admin.end();
    }
  });

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
