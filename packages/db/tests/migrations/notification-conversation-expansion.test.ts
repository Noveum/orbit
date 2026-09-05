import { afterAll, describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { currentLane, laneDatabase } from '../../../../scripts/test-env.ts';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://orbit:orbit@localhost:5434/orbit';
const SCRATCH = laneDatabase('orbit_test_notification_conversation_migration', currentLane());
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

async function resetScratch(): Promise<void> {
  await run(urlFor('postgres'), async (sql) => {
    await sql.unsafe(`drop database if exists "${SCRATCH}"`);
    await sql.unsafe(`create database "${SCRATCH}"`);
  });
  await run(urlFor(SCRATCH), async (sql) => {
    await sql`create extension if not exists pg_trgm`;
    for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS })) {
      for (const statement of migration.sql) await sql.unsafe(statement);
    }
  });
}

async function seedCanonicalRows(sql: postgres.Sql): Promise<void> {
  await sql`insert into "user" (id, name, email, handle) values ('user-1', 'User', 'user@example.com', 'user')`;
  await sql`insert into organization (id, name, slug) values ('org-1', 'Org', 'org')`;
  await sql`
    insert into notification_source_event (
      id, organization_id, source_event_key, subject_type, subject_key, occurred_at
    ) values
      ('source-1', 'org-1', 'source:1', 'issue', 'orbit-issue:issue-1:activity', now()),
      ('source-2', 'org-1', 'source:2', 'issue', 'orbit-issue:issue-1:activity', now())
  `;
  await sql`
    insert into notification_inbox_state (organization_id, user_id)
    values ('org-1', 'user-1')
  `;
  await sql`
    insert into notification_conversation (
      id, organization_id, user_id, conversation_key, subject_type, subject_id, category
    ) values (
      'conversation-1', 'org-1', 'user-1', 'orbit-issue:issue-1:activity',
      'issue', 'issue-1', 'activity'
    )
  `;
  await sql`
    insert into notification (
      id, organization_id, user_id, type, actor_id, actor_name, entity_type,
      entity_id, title, url, source_event_id, conversation_id, occurred_at,
      ingested_at, ingestion_seq, surface_in_inbox
    ) values (
      'notification-1', 'org-1', 'user-1', 'comment_created', 'actor-1', 'Actor',
      'issue', 'issue-1', 'Comment', '/issue/ISS-1', 'source-1', 'conversation-1',
      now(), now(), 1, true
    )
  `;
  await sql`
    update notification_conversation
    set latest_event_id = 'notification-1', event_count = 1, unread_event_count = 1,
        last_activity_seq = 1, last_activity_at = now()
    where id = 'conversation-1'
  `;
}

describe('notification conversation expansion migration', () => {
  afterAll(async () => {
    await run(urlFor('postgres'), (sql) => sql.unsafe(`drop database if exists "${SCRATCH}"`));
  }, 30_000);

  it('creates the conversation tables and accepts a valid audit duplicate', async () => {
    await resetScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await seedCanonicalRows(sql);
      await sql`
        insert into notification (
          id, organization_id, user_id, type, actor_id, actor_name, entity_type,
          entity_id, title, url, conversation_id, occurred_at, ingested_at,
          ingestion_seq, surface_in_inbox, deduplicated_into_notification_id
        ) values (
          'notification-audit', 'org-1', 'user-1', 'comment_created', 'actor-1',
          'Actor', 'issue', 'issue-1', 'Duplicate', '/issue/ISS-1', 'conversation-1',
          now(), now(), 2, false, 'notification-1'
        )
      `;
      const [counts] = await sql<
        { conversations: number; inbox_states: number; duplicates: number }[]
      >`
        select
          (select count(*)::int from notification_conversation) as conversations,
          (select count(*)::int from notification_inbox_state) as inbox_states,
          (select count(*)::int from notification where deduplicated_into_notification_id is not null) as duplicates
      `;
      expect(counts).toEqual({ conversations: 1, inbox_states: 1, duplicates: 1 });
    });
  }, 60_000);

  it('rejects audit chains and survivor demotion at the deferred boundary', async () => {
    await resetScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await seedCanonicalRows(sql);
      await sql`
        insert into notification (
          id, organization_id, user_id, type, actor_id, actor_name, entity_type,
          entity_id, title, url, conversation_id, occurred_at, ingested_at,
          ingestion_seq, surface_in_inbox, deduplicated_into_notification_id
        ) values (
          'notification-audit', 'org-1', 'user-1', 'comment_created', 'actor-1',
          'Actor', 'issue', 'issue-1', 'Duplicate', '/issue/ISS-1', 'conversation-1',
          now(), now(), 2, false, 'notification-1'
        )
      `;
      await expect(
        sql.begin(async (tx) => {
          await tx`
            insert into notification (
              id, organization_id, user_id, type, actor_id, actor_name, entity_type,
              entity_id, title, url, conversation_id, occurred_at, ingested_at,
              ingestion_seq, surface_in_inbox, deduplicated_into_notification_id
            ) values (
              'notification-chain', 'org-1', 'user-1', 'comment_created', 'actor-1',
              'Actor', 'issue', 'issue-1', 'Chain', '/issue/ISS-1', 'conversation-1',
              now(), now(), 3, false, 'notification-audit'
            )
          `;
        }),
      ).rejects.toThrow('canonical survivor');
      await expect(
        sql.begin(async (tx) => {
          await tx`
            update notification
            set source_event_id = null
            where id = 'notification-1'
          `;
        }),
      ).rejects.toThrow('cannot be demoted');
      await expect(
        sql.begin(async (tx) => {
          await tx`
            update notification
            set source_event_id = 'source-2'
            where id = 'notification-1'
          `;
        }),
      ).rejects.toThrow('cannot be demoted');
    });
  }, 60_000);

  it('rejects delivery audit chains and canonical source reassignment', async () => {
    await resetScratch();
    await run(urlFor(SCRATCH), async (sql) => {
      await seedCanonicalRows(sql);
      await sql`
        insert into integration (
          id, organization_id, provider, external_id, connected_by_id
        ) values ('integration-1', 'org-1', 'slack', 'workspace-1', 'user-1')
      `;
      await sql`
        insert into notification_delivery (
          id, notification_id, organization_id, source_event_id, user_id, channel,
          destination_kind, destination_id, integration_id, status
        ) values (
          'delivery-1', 'notification-1', 'org-1', 'source-1', 'user-1', 'slack_dm',
          'user', 'U1', 'integration-1', 'delivered'
        )
      `;
      await sql`
        insert into notification_delivery (
          id, organization_id, channel, status, deduplicated_into_delivery_id
        ) values ('delivery-audit', 'org-1', 'slack_dm', 'delivered', 'delivery-1')
      `;
      await expect(
        sql.begin(async (tx) => {
          await tx`
            update notification_delivery
            set source_event_id = 'source-2'
            where id = 'delivery-1'
          `;
        }),
      ).rejects.toThrow('cannot be demoted');
      await expect(
        sql.begin(async (tx) => {
          await tx`
            insert into notification_delivery (
              id, organization_id, channel, status, deduplicated_into_delivery_id
            ) values (
              'delivery-chain', 'org-1', 'slack_dm', 'delivered', 'delivery-audit'
            )
          `;
        }),
      ).rejects.toThrow('canonical survivor');
    });
  }, 60_000);
});
