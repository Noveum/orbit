import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { mcpGrant } from './oauth.ts';
import { organization } from './org.ts';

export const mcpIdempotency = pgTable(
  'mcp_idempotency',
  {
    id: text('id').primaryKey(),
    grantId: text('grant_id')
      .notNull()
      .references(() => mcpGrant.id, { onDelete: 'restrict' }),
    toolName: text('tool_name').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mcp_idempotency_grant_tool_key_unique').on(
      table.grantId,
      table.toolName,
      table.idempotencyKey,
    ),
    index('mcp_idempotency_expires_idx').on(table.expiresAt),
  ],
);

export const issueOutbox = pgTable(
  'issue_outbox',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    aggregateId: text('aggregate_id').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull(),
    payload: jsonb('payload').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    leaseOwner: text('lease_owner'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('issue_outbox_available_idx').on(table.availableAt, table.id),
    index('issue_outbox_aggregate_sync_idx').on(table.aggregateId, table.syncId),
  ],
);
