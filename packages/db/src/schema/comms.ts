import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { comment } from './content.ts';
import { organization, team } from './org.ts';
import { issue, workflowState } from './work.ts';

export const notificationReason = pgEnum('notification_reason', [
  'assigned',
  'mentioned',
  'subscribed',
  'commented',
  'state_changed',
  'review_requested',
  'review_approved',
  'pull_request_merged',
  'due_soon',
  'manual',
]);

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
    reason: notificationReason('reason'),
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
  (table) => [
    uniqueIndex('notification_preference_unique').on(table.userId, table.channel, table.type),
  ],
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
    uniqueIndex('integration_org_provider_unique').on(
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
    uniqueIndex('integration_channel_unique').on(
      table.integrationId,
      table.entityType,
      table.entityId,
      table.channelId,
    ),
  ],
);

export const githubRepositorySync = pgTable(
  'github_repository_sync',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    repositoryName: text('repository_name').notNull(),
    installationId: text('installation_id').notNull().default(''),
    defaultBranch: text('default_branch').notNull().default('main'),
    enabled: boolean('enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_repository_sync_unique').on(table.organizationId, table.repositoryId),
    index('github_repository_sync_team_idx').on(table.teamId),
  ],
);

export const githubIssueSync = pgTable(
  'github_issue_sync',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    externalNumber: bigint('external_number', { mode: 'number' }),
    externalUrl: text('external_url').notNull().default(''),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_issue_sync_unique').on(table.repositorySyncId, table.externalId),
    index('github_issue_sync_issue_idx').on(table.issueId),
    foreignKey({
      name: 'github_issue_sync_repository_sync_fk',
      columns: [table.repositorySyncId],
      foreignColumns: [githubRepositorySync.id],
    }).onDelete('cascade'),
  ],
);

export const githubCommentSync = pgTable(
  'github_comment_sync',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    commentId: text('comment_id')
      .notNull()
      .references(() => comment.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url').notNull().default(''),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_comment_sync_unique').on(table.repositorySyncId, table.externalId),
    index('github_comment_sync_comment_idx').on(table.commentId),
    foreignKey({
      name: 'github_comment_sync_repository_sync_fk',
      columns: [table.repositorySyncId],
      foreignColumns: [githubRepositorySync.id],
    }).onDelete('cascade'),
  ],
);

export const githubPrStateMapping = pgTable(
  'github_pr_state_mapping',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    pullRequestState: text('pull_request_state').notNull(),
    stateId: text('state_id')
      .notNull()
      .references(() => workflowState.id, { onDelete: 'cascade' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_pr_state_mapping_unique').on(
      table.repositorySyncId,
      table.pullRequestState,
    ),
    foreignKey({
      name: 'github_pr_state_mapping_repository_sync_fk',
      columns: [table.repositorySyncId],
      foreignColumns: [githubRepositorySync.id],
    }).onDelete('cascade'),
  ],
);

export const slackChannelSync = pgTable(
  'slack_channel_sync',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    channelName: text('channel_name').notNull().default(''),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('slack_channel_sync_unique').on(table.integrationId, table.channelId),
    index('slack_channel_sync_team_idx').on(table.teamId),
  ],
);

export const webhook = pgTable(
  'webhook',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [index('webhook_org_idx').on(table.organizationId)],
);

export const webhookLog = pgTable(
  'webhook_log',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    webhookId: text('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    status: text('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(1),
    requestBody: jsonb('request_body').$type<Record<string, unknown>>().notNull().default({}),
    responseStatus: integer('response_status'),
    responseBody: text('response_body').notNull().default(''),
    error: text('error'),
    durationMs: integer('duration_ms'),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('webhook_log_webhook_idx').on(table.webhookId, table.createdAt)],
);

export const gitLink = pgTable(
  'git_link',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
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
    uniqueIndex('git_link_unique').on(table.provider, table.externalId),
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
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    targetStateId: text('target_state_id'),
    branchPattern: text('branch_pattern'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('automation_rule_unique').on(table.teamId, table.event, table.branchPattern),
  ],
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
  (table) => [uniqueIndex('webhook_delivery_unique').on(table.provider, table.deliveryId)],
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
