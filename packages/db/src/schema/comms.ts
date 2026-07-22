import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './org.ts';

export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorType: text('actor_type').notNull().default('user'),
    actorId: text('actor_id').notNull(),
    actorName: text('actor_name').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    url: text('url').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    deliveredChannels: jsonb('delivered_channels').$type<string[]>().notNull().default([]),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_user_idx').on(table.userId, table.createdAt),
    index('notification_unread_idx').on(table.userId, table.readAt),
  ],
);

export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (table) => [unique('notification_preference_unique').on(table.userId, table.channel, table.type)],
);

export const notificationSetting = pgTable('notification_setting', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true),
  quietHoursStart: text('quiet_hours_start').notNull().default('18:00'),
  quietHoursEnd: text('quiet_hours_end').notNull().default('09:00'),
  urgentBypassEnabled: boolean('urgent_bypass_enabled').notNull().default(true),
  digestEnabled: boolean('digest_enabled').notNull().default(true),
});

export const emailDelivery = pgTable(
  'email_delivery',
  {
    id: text('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    template: text('template').notNull(),
    status: text('status').notNull().default('queued'),
    providerId: text('provider_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('email_delivery_status_idx').on(table.status, table.createdAt)],
);

export const integration = pgTable(
  'integration',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    credentials: jsonb('credentials').$type<Record<string, unknown>>().notNull().default({}),
    connectedById: text('connected_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('integration_org_provider_unique').on(
      table.organizationId,
      table.provider,
      table.externalId,
    ),
  ],
);

export const integrationChannel = pgTable(
  'integration_channel',
  {
    id: text('id').primaryKey(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    channelId: text('channel_id').notNull(),
    channelName: text('channel_name').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('integration_channel_unique').on(
      table.integrationId,
      table.entityType,
      table.entityId,
      table.channelId,
    ),
  ],
);

export const gitLink = pgTable(
  'git_link',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    issueId: text('issue_id').notNull(),
    provider: text('provider').notNull().default('github'),
    kind: text('kind').notNull(),
    externalId: text('external_id').notNull(),
    number: bigint('number', { mode: 'number' }),
    repository: text('repository').notNull(),
    branch: text('branch'),
    title: text('title').notNull().default(''),
    url: text('url').notNull(),
    state: text('state').notNull().default('open'),
    draft: boolean('draft').notNull().default(false),
    merged: boolean('merged').notNull().default(false),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('git_link_unique').on(table.provider, table.externalId),
    index('git_link_issue_idx').on(table.issueId),
  ],
);

export const automationRule = pgTable(
  'automation_rule',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id').notNull(),
    event: text('event').notNull(),
    targetStateId: text('target_state_id'),
    branchPattern: text('branch_pattern'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('automation_rule_unique').on(table.teamId, table.event, table.branchPattern)],
);

export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    deliveryId: text('delivery_id').notNull(),
    event: text('event').notNull(),
    status: text('status').notNull().default('received'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('webhook_delivery_unique').on(table.provider, table.deliveryId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull().default('user'),
    actorId: text('actor_id').notNull(),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_log_org_idx').on(table.organizationId, table.createdAt)],
);

export const apiKey = pgTable(
  'api_key',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    hashedKey: text('hashed_key').notNull().unique(),
    prefix: text('prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('api_key_org_idx').on(table.organizationId)],
);
