import { describe, expect, it } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../src/schema/index.ts';

function columnNames(table: PgTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name);
}

function indexNames(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.map((entry) => entry.config.name)
    .filter((name): name is string => name !== undefined);
}

function checkNames(table: PgTable): string[] {
  return getTableConfig(table).checks.map((entry) => entry.name);
}

function foreignKeyNames(table: PgTable): string[] {
  return getTableConfig(table).foreignKeys.map((entry) => entry.getName());
}

function foreignKeyColumns(
  table: PgTable,
  name: string,
): { readonly columns: string[]; readonly foreignColumns: string[] } {
  const key = getTableConfig(table).foreignKeys.find((entry) => entry.getName() === name);
  if (key === undefined) throw new Error(`${name} is not a foreign key on this table.`);
  const reference = key.reference();
  return {
    columns: reference.columns.map((column) => column.name),
    foreignColumns: reference.foreignColumns.map((column) => column.name),
  };
}

function checkExpression(table: PgTable, name: string): string {
  const constraint = getTableConfig(table).checks.find((entry) => entry.name === name);
  if (constraint === undefined) throw new Error(`${name} is not a check on this table.`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function indexPredicate(table: PgTable, name: string): string {
  const index = getTableConfig(table).indexes.find((entry) => entry.config.name === name)?.config;
  if (index?.where === undefined) throw new Error(`${name} has no predicate.`);
  return new PgDialect().sqlToQuery(index.where).sql;
}

describe('notification conversation expansion schema', () => {
  it('stores a tenant-scoped conversation summary and durable recipient counters', () => {
    expect(columnNames(schema.notificationConversation)).toEqual(
      expect.arrayContaining([
        'organization_id',
        'user_id',
        'conversation_key',
        'subject_type',
        'subject_id',
        'category',
        'latest_event_id',
        'event_count',
        'unread_event_count',
        'unread_mention_count',
        'manual_unread',
        'access_generation',
        'snooze_generation',
        'last_activity_seq',
        'sync_id',
      ]),
    );
    expect(indexNames(schema.notificationConversation)).toEqual(
      expect.arrayContaining([
        'notification_conversation_org_user_key_unique',
        'notification_conversation_list_idx',
        'notification_conversation_unread_idx',
        'notification_conversation_mentions_idx',
        'notification_conversation_pull_request_idx',
        'notification_conversation_snooze_idx',
      ]),
    );
    expect(checkNames(schema.notificationConversation)).toEqual(
      expect.arrayContaining([
        'notification_conversation_category_check',
        'notification_conversation_counts_check',
        'notification_conversation_generations_check',
      ]),
    );
    expect(
      checkExpression(schema.notificationConversation, 'notification_conversation_counts_check'),
    ).toContain('"manual_unread" is false');
    expect(foreignKeyNames(schema.notificationConversation)).toContain(
      'notification_conversation_latest_event_fk',
    );
    expect(
      foreignKeyColumns(
        schema.notificationConversation,
        'notification_conversation_latest_event_fk',
      ),
    ).toEqual({
      columns: ['organization_id', 'latest_event_id', 'user_id'],
      foreignColumns: ['organization_id', 'id', 'user_id'],
    });
  });

  it('stores versioned inbox counters and generation-fenced snooze work', () => {
    expect(columnNames(schema.notificationInboxState)).toEqual(
      expect.arrayContaining([
        'organization_id',
        'user_id',
        'unread_count',
        'unread_activity_count',
        'unread_mention_count',
        'sync_id',
      ]),
    );
    expect(checkNames(schema.notificationInboxState)).toContain(
      'notification_inbox_state_counts_check',
    );
    const inboxPrimaryKey = getTableConfig(schema.notificationInboxState).primaryKeys[0];
    expect(inboxPrimaryKey?.getName()).toBe('notification_inbox_state_org_user_pk');
    expect(inboxPrimaryKey?.columns.map((column) => column.name)).toEqual([
      'organization_id',
      'user_id',
    ]);
    expect(columnNames(schema.notificationSnoozeWake)).toEqual(
      expect.arrayContaining([
        'organization_id',
        'user_id',
        'conversation_id',
        'snooze_generation',
        'wake_at',
        'status',
        'claim_token',
        'claimed_at',
        'lease_expires_at',
        'attempts',
        'completed_at',
      ]),
    );
    expect(foreignKeyNames(schema.notificationSnoozeWake)).toEqual(
      expect.arrayContaining([
        'notification_snooze_wake_conversation_fk',
        'notification_snooze_wake_inbox_state_fk',
      ]),
    );
    expect(indexNames(schema.notificationSnoozeWake)).toContain('notification_snooze_wake_due_idx');
  });

  it('persists a tenant and phase scoped resumable backfill cursor', () => {
    expect(columnNames(schema.notificationConversationBackfillProgress)).toEqual(
      expect.arrayContaining([
        'organization_id',
        'phase',
        'cursor',
        'high_water_mark',
        'status',
        'processed_rows',
        'started_at',
        'updated_at',
        'completed_at',
        'last_error',
      ]),
    );
    expect(indexNames(schema.notificationConversationBackfillProgress)).toEqual(
      expect.arrayContaining([
        'notification_conversation_backfill_org_phase_unique',
        'notification_conversation_backfill_status_idx',
      ]),
    );
  });

  it('links immutable events to conversations and classifies historical duplicates safely', () => {
    expect(columnNames(schema.notification)).toEqual(
      expect.arrayContaining([
        'conversation_id',
        'occurred_at',
        'ingested_at',
        'ingestion_seq',
        'surface_in_inbox',
        'deduplicated_into_notification_id',
      ]),
    );
    expect(foreignKeyNames(schema.notification)).toEqual(
      expect.arrayContaining(['notification_conversation_fk', 'notification_deduplicated_into_fk']),
    );
    expect(checkNames(schema.notification)).toEqual(
      expect.arrayContaining([
        'notification_conversation_shape_check',
        'notification_deduplicated_shape_check',
      ]),
    );
    expect(foreignKeyColumns(schema.notification, 'notification_conversation_fk')).toEqual({
      columns: ['organization_id', 'conversation_id', 'user_id'],
      foreignColumns: ['organization_id', 'id', 'user_id'],
    });
    expect(foreignKeyColumns(schema.notification, 'notification_deduplicated_into_fk')).toEqual({
      columns: ['organization_id', 'deduplicated_into_notification_id', 'user_id'],
      foreignColumns: ['organization_id', 'id', 'user_id'],
    });
    expect(checkExpression(schema.notification, 'notification_deduplicated_shape_check')).toContain(
      '"surface_in_inbox" is false',
    );
  });

  it('expands delivery audit, provider identity, and fenced lease state', () => {
    expect(columnNames(schema.notificationDelivery)).toEqual(
      expect.arrayContaining([
        'conversation_key',
        'deduplicated_into_delivery_id',
        'slack_team_id',
        'slack_app_id',
        'credential_generation',
        'provider_request_id',
        'provider_message_id',
        'provider_payload_hash',
        'provider_idempotency_expires_at',
        'claim_token',
        'lease_expires_at',
        'send_started_at',
        'dead_lettered_at',
      ]),
    );
    expect(foreignKeyNames(schema.notificationDelivery)).toContain(
      'notification_delivery_deduplicated_into_fk',
    );
    expect(
      foreignKeyColumns(schema.notificationDelivery, 'notification_delivery_deduplicated_into_fk'),
    ).toEqual({
      columns: ['organization_id', 'deduplicated_into_delivery_id'],
      foreignColumns: ['organization_id', 'id'],
    });
    expect(checkNames(schema.notificationDelivery)).toContain(
      'notification_delivery_deduplicated_shape_check',
    );
    expect(
      indexPredicate(
        schema.notificationDelivery,
        'notification_delivery_source_destination_unique',
      ),
    ).toContain('deduplicated_into_delivery_id');
  });
});
