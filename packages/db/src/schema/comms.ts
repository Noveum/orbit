import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { comment } from './content.ts';
import { organization, team } from './org.ts';
import { issue, project, workflowState } from './work.ts';

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
  'access_requested',
  'access_granted',
  'manual',
]);

export const notificationSourceEvent = pgTable(
  'notification_source_event',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    sourceEventKey: text('source_event_key').notNull(),
    sourceDeliveryId: text('source_delivery_id'),
    subjectType: text('subject_type').notNull(),
    subjectKey: text('subject_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    ingestionSeq: bigint('ingestion_seq', { mode: 'number' })
      .notNull()
      .default(sql`nextval('sync_id_seq')`),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    fanoutCompletedAt: timestamp('fanout_completed_at', { withTimezone: true }),
    prunedAt: timestamp('pruned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('notification_source_event_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('notification_source_event_org_key_unique').on(
      table.organizationId,
      table.sourceEventKey,
    ),
    index('notification_source_event_delivery_idx')
      .on(table.sourceDeliveryId)
      .where(sql`${table.sourceDeliveryId} is not null`),
  ],
);

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
    externalUrl: text('external_url'),
    sourceEventId: text('source_event_id').references(() => notificationSourceEvent.id, {
      onDelete: 'restrict',
    }),
    readAt: timestamp('read_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    manualUnreadAnchor: boolean('manual_unread_anchor').notNull().default(false),
    deliveredChannels: jsonb('delivered_channels').$type<string[]>().notNull().default([]),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_user_idx').on(table.userId, table.createdAt),
    index('notification_unread_idx').on(table.userId, table.readAt),
    unique('notification_org_id_user_unique').on(table.organizationId, table.id, table.userId),
    uniqueIndex('notification_source_user_unique')
      .on(table.sourceEventId, table.userId)
      .where(sql`${table.sourceEventId} is not null`),
    foreignKey({
      name: 'notification_org_source_event_fk',
      columns: [table.organizationId, table.sourceEventId],
      foreignColumns: [notificationSourceEvent.organizationId, notificationSourceEvent.id],
    }),
  ],
);

export const notificationDelivery = pgTable(
  'notification_delivery',
  {
    id: text('id').primaryKey(),
    notificationId: text('notification_id').references(() => notification.id, {
      onDelete: 'cascade',
    }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    sourceEventId: text('source_event_id').references(() => notificationSourceEvent.id, {
      onDelete: 'restrict',
    }),
    sourceDeliveryId: text('source_delivery_id'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    destinationKind: text('destination_kind'),
    destinationId: text('destination_id'),
    integrationId: text('integration_id'),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    providerMessageChannel: text('provider_message_channel'),
    providerMessageTs: text('provider_message_ts'),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_delivery_unique').on(
      table.notificationId,
      table.userId,
      table.channel,
    ),
    index('notification_delivery_source_lookup_idx')
      .on(table.sourceDeliveryId, table.userId, table.channel)
      .where(sql`${table.sourceDeliveryId} is not null`),
    index('notification_delivery_pending_idx').on(table.status, table.availableAt),
    uniqueIndex('notification_delivery_source_destination_unique')
      .on(
        table.organizationId,
        table.sourceEventId,
        table.channel,
        table.destinationKind,
        table.destinationId,
      )
      .where(sql`${table.sourceEventId} is not null`),
    foreignKey({
      name: 'notification_delivery_org_source_event_fk',
      columns: [table.organizationId, table.sourceEventId],
      foreignColumns: [notificationSourceEvent.organizationId, notificationSourceEvent.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'notification_delivery_org_notification_user_fk',
      columns: [table.organizationId, table.notificationId, table.userId],
      foreignColumns: [notification.organizationId, notification.id, notification.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'notification_delivery_org_integration_fk',
      columns: [table.organizationId, table.integrationId],
      foreignColumns: [integration.organizationId, integration.id],
    }).onDelete('cascade'),
    check(
      'notification_delivery_owner_shape_check',
      sql`(
        (
          ${table.sourceEventId} is null
          and ${table.notificationId} is not null
          and ${table.userId} is not null
        )
        or
        (
          ${table.sourceEventId} is not null
          and ${table.organizationId} is not null
          and ${table.destinationKind} is not null
          and ${table.destinationId} is not null
          and (
            (
              ${table.destinationKind} = 'user'
              and ${table.channel} = 'slack_dm'
              and ${table.notificationId} is not null
              and ${table.userId} is not null
              and ${table.integrationId} is not null
            )
            or
            (
              ${table.destinationKind} = 'shared_channel'
              and ${table.channel} = 'slack'
              and ${table.notificationId} is null
              and ${table.userId} is null
              and ${table.integrationId} is not null
              and ${table.providerPayload} is not null
            )
          )
        )
      )`,
    ),
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
    unique('integration_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('integration_org_provider_unique').on(
      table.organizationId,
      table.provider,
      table.externalId,
    ),
    uniqueIndex('integration_provider_slack_team_idx')
      .on(sql`coalesce(${table.config} ->> 'slackTeamId', nullif(${table.externalId}, 'default'))`)
      .where(
        sql`${table.provider} = 'slack' and coalesce(${table.config} ->> 'slackTeamId', nullif(${table.externalId}, 'default')) is not null`,
      ),
    index('integration_provider_external_idx').on(table.provider, table.externalId),
  ],
);

export const integrationOauthState = pgTable(
  'integration_oauth_state',
  {
    nonce: text('nonce').primaryKey(),
    provider: text('provider').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('integration_oauth_state_expires_idx').on(table.expiresAt)],
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

export const githubInstallation = pgTable(
  'github_installation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    installationId: text('installation_id').notNull(),
    accountLogin: text('account_login').notNull().default(''),
    accountId: text('account_id').notNull().default(''),
    accountType: text('account_type').notNull().default('Organization'),
    repositorySelection: text('repository_selection').notNull().default('selected'),
    status: text('status').notNull().default('active'),
    connectedById: text('connected_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoriesSyncedAt: timestamp('repositories_synced_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_installation_installation_unique').on(table.installationId),
    index('github_installation_org_idx').on(table.organizationId),
  ],
);

export const githubRepository = pgTable(
  'github_repository',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    installationRowId: text('installation_row_id')
      .notNull()
      .references(() => githubInstallation.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    fullName: text('full_name').notNull(),
    name: text('name').notNull().default(''),
    ownerLogin: text('owner_login').notNull().default(''),
    private: boolean('private').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    defaultBranch: text('default_branch').notNull().default('main'),
    htmlUrl: text('html_url').notNull().default(''),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_repository_unique').on(table.installationRowId, table.repositoryId),
    index('github_repository_org_idx').on(table.organizationId),
  ],
);

export const githubRepositoryLink = pgTable(
  'github_repository_link',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositoryRowId: text('repository_row_id')
      .notNull()
      .references(() => githubRepository.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
    linkedById: text('linked_by_id').references(() => user.id, { onDelete: 'set null' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_repository_link_project_unique')
      .on(table.repositoryRowId, table.projectId)
      .where(sql`${table.projectId} is not null`),
    uniqueIndex('github_repository_link_workspace_unique')
      .on(table.repositoryRowId)
      .where(sql`${table.projectId} is null`),
    index('github_repository_link_project_idx').on(table.projectId),
    index('github_repository_link_org_idx').on(table.organizationId),
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
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    repositoryName: text('repository_name').notNull(),
    installationId: text('installation_id').notNull().default(''),
    defaultBranch: text('default_branch').notNull().default('main'),
    enabled: boolean('enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    pullRequestsBackfilledAt: timestamp('pull_requests_backfilled_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_repository_sync_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('github_repository_sync_unique').on(table.organizationId, table.repositoryId),
    index('github_repository_sync_team_idx').on(table.teamId),
  ],
);

export const githubPullRequest = pgTable(
  'github_pull_request',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id')
      .notNull()
      .references(() => githubRepositorySync.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').notNull(),
    repositoryName: text('repository_name').notNull(),
    number: bigint('number', { mode: 'number' }).notNull(),
    nodeId: text('node_id').notNull().default(''),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    url: text('url').notNull(),
    headRef: text('head_ref').notNull().default(''),
    headSha: text('head_sha').notNull().default(''),
    headEpoch: bigint('head_epoch', { mode: 'number' }).notNull().default(0),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    baseRef: text('base_ref').notNull().default(''),
    state: text('state').notNull().default('open'),
    draft: boolean('draft').notNull().default(false),
    merged: boolean('merged').notNull().default(false),
    authorLogin: text('author_login').notNull().default(''),
    authorId: text('author_id').notNull().default(''),
    reviewDecision: text('review_decision'),
    checkStatus: text('check_status').notNull().default('unknown'),
    githubCreatedAt: timestamp('github_created_at', { withTimezone: true }),
    githubUpdatedAt: timestamp('github_updated_at', { withTimezone: true }),
    historySyncedAt: timestamp('history_synced_at', { withTimezone: true }),
    historyRefreshClaimedAt: timestamp('history_refresh_claimed_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull().defaultNow(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_pull_request_org_id_unique').on(table.organizationId, table.id),
    unique('github_pull_request_org_repository_id_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.id,
    ),
    uniqueIndex('github_pull_request_repository_number_unique').on(
      table.repositorySyncId,
      table.number,
    ),
    index('github_pull_request_org_updated_idx').on(table.organizationId, table.updatedAt),
    index('github_pull_request_repository_identity_idx').on(
      table.organizationId,
      table.repositoryId,
      table.number,
    ),
    check('github_pull_request_head_epoch_check', sql`${table.headEpoch} >= 0`),
  ],
);

export const githubPullRequestActivity = pgTable(
  'github_pull_request_activity',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => githubPullRequest.id, { onDelete: 'cascade' }),
    checkActivityId: text('check_activity_id'),
    externalId: text('external_id').notNull(),
    type: text('type').notNull(),
    action: text('action').notNull(),
    actorLogin: text('actor_login').notNull().default(''),
    actorId: text('actor_id').notNull().default(''),
    body: text('body').notNull().default(''),
    url: text('url').notNull().default(''),
    state: text('state').notNull().default(''),
    path: text('path'),
    line: integer('line'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_pull_request_activity_external_unique').on(
      table.pullRequestId,
      table.externalId,
    ),
    index('github_pull_request_activity_timeline_idx').on(table.pullRequestId, table.occurredAt),
    index('github_pull_request_activity_org_idx').on(table.organizationId),
    foreignKey({
      name: 'github_pull_request_activity_org_check_activity_fk',
      columns: [table.organizationId, table.checkActivityId],
      foreignColumns: [githubCheckActivity.organizationId, githubCheckActivity.id],
    }).onDelete('restrict'),
  ],
);

function checkFetchOrganizationColumn(): AnyPgColumn {
  return githubCheckReconciliationFetch.organizationId;
}

function checkFetchRepositoryColumn(): AnyPgColumn {
  return githubCheckReconciliationFetch.repositorySyncId;
}

function checkFetchHeadColumn(): AnyPgColumn {
  return githubCheckReconciliationFetch.headSha;
}

function checkFetchIdColumn(): AnyPgColumn {
  return githubCheckReconciliationFetch.id;
}

function checkReconciliationOrganizationColumn(): AnyPgColumn {
  return githubCheckHeadReconciliation.organizationId;
}

function checkReconciliationRepositoryColumn(): AnyPgColumn {
  return githubCheckHeadReconciliation.repositorySyncId;
}

function checkReconciliationHeadColumn(): AnyPgColumn {
  return githubCheckHeadReconciliation.headSha;
}

function checkReconciliationIdColumn(): AnyPgColumn {
  return githubCheckHeadReconciliation.id;
}

export const githubCheckHeadReconciliation = pgTable(
  'github_check_head_reconciliation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    headSha: text('head_sha').notNull(),
    status: text('status').notNull().default('pending'),
    jobVersion: bigint('job_version', { mode: 'number' }).notNull().default(0),
    contextGeneration: bigint('context_generation', { mode: 'number' }).notNull().default(0),
    triggerKind: text('trigger_kind').notNull(),
    triggerIdentity: text('trigger_identity').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    settleDeadline: timestamp('settle_deadline', { withTimezone: true }),
    rerunRequired: boolean('rerun_required').notNull().default(false),
    claimToken: text('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimedJobVersion: bigint('claimed_job_version', { mode: 'number' }),
    claimedContextGeneration: bigint('claimed_context_generation', { mode: 'number' }),
    acceptedFetchAttemptId: text('accepted_fetch_attempt_id'),
    acceptedJobVersion: bigint('accepted_job_version', { mode: 'number' }),
    acceptedContextGeneration: bigint('accepted_context_generation', { mode: 'number' }),
    latestSnapshot: jsonb('latest_snapshot').$type<Record<string, unknown>[]>(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_check_head_reconciliation_owner_id_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
      table.id,
    ),
    unique('github_check_head_reconciliation_head_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
    ),
    index('github_check_head_reconciliation_pending_idx').on(table.status, table.availableAt),
    foreignKey({
      name: 'github_check_head_reconciliation_repository_fk',
      columns: [table.organizationId, table.repositorySyncId],
      foreignColumns: [githubRepositorySync.organizationId, githubRepositorySync.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'github_check_head_reconciliation_accepted_fetch_fk',
      columns: [
        table.organizationId,
        table.repositorySyncId,
        table.headSha,
        table.acceptedFetchAttemptId,
      ],
      foreignColumns: [
        checkFetchOrganizationColumn(),
        checkFetchRepositoryColumn(),
        checkFetchHeadColumn(),
        checkFetchIdColumn(),
      ],
    }).onDelete('restrict'),
    check(
      'github_check_head_reconciliation_status_check',
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed', 'unavailable')`,
    ),
    check(
      'github_check_head_reconciliation_versions_check',
      sql`${table.jobVersion} >= 0 and ${table.contextGeneration} >= 0 and ${table.attempts} >= 0`,
    ),
    check(
      'github_check_head_reconciliation_claim_check',
      sql`(
        ${table.status} = 'processing'
        and ${table.claimToken} is not null
        and ${table.claimedAt} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.claimedJobVersion} is not null
        and ${table.claimedContextGeneration} is not null
      ) or (
        ${table.status} <> 'processing'
        and ${table.claimToken} is null
        and ${table.claimedAt} is null
        and ${table.leaseExpiresAt} is null
        and ${table.claimedJobVersion} is null
        and ${table.claimedContextGeneration} is null
      )`,
    ),
  ],
);

export const githubCheckReconciliationFetch = pgTable(
  'github_check_reconciliation_fetch',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    headSha: text('head_sha').notNull(),
    headReconciliationId: text('head_reconciliation_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    capturedJobVersion: bigint('captured_job_version', { mode: 'number' }).notNull(),
    capturedContextGeneration: bigint('captured_context_generation', { mode: 'number' }).notNull(),
    claimToken: text('claim_token').notNull(),
    disposition: text('disposition').notNull().default('started'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    resultHash: text('result_hash'),
    failure: text('failure'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_check_reconciliation_fetch_owner_id_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
      table.id,
    ),
    uniqueIndex('github_check_reconciliation_fetch_attempt_unique').on(
      table.headReconciliationId,
      table.capturedJobVersion,
      table.attemptNumber,
    ),
    index('github_check_reconciliation_fetch_disposition_idx').on(
      table.disposition,
      table.requestedAt,
    ),
    foreignKey({
      name: 'github_check_reconciliation_fetch_repository_fk',
      columns: [table.organizationId, table.repositorySyncId],
      foreignColumns: [githubRepositorySync.organizationId, githubRepositorySync.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'github_check_reconciliation_fetch_head_fk',
      columns: [
        table.organizationId,
        table.repositorySyncId,
        table.headSha,
        table.headReconciliationId,
      ],
      foreignColumns: [
        checkReconciliationOrganizationColumn(),
        checkReconciliationRepositoryColumn(),
        checkReconciliationHeadColumn(),
        checkReconciliationIdColumn(),
      ],
    }).onDelete('cascade'),
    check(
      'github_check_reconciliation_fetch_disposition_check',
      sql`${table.disposition} in ('started', 'fetched', 'failed', 'accepted', 'invalidated', 'abandoned')`,
    ),
    check(
      'github_check_reconciliation_fetch_versions_check',
      sql`${table.attemptNumber} > 0 and ${table.capturedJobVersion} >= 0 and ${table.capturedContextGeneration} >= 0`,
    ),
  ],
);

export const githubCheckActivity = pgTable(
  'github_check_activity',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    headSha: text('head_sha').notNull(),
    sourceKind: text('source_kind').notNull(),
    contextKey: text('context_key').notNull(),
    providerObjectId: text('provider_object_id').notNull(),
    providerRunId: text('provider_run_id'),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }).notNull(),
    webhookDeliveryId: text('webhook_delivery_id'),
    reconciliationFetchId: text('reconciliation_fetch_id'),
    state: text('state').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_check_activity_org_id_unique').on(table.organizationId, table.id),
    unique('github_check_activity_owner_id_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
      table.id,
    ),
    uniqueIndex('github_check_activity_webhook_unique')
      .on(
        table.organizationId,
        table.repositorySyncId,
        table.webhookDeliveryId,
        table.sourceKind,
        table.providerObjectId,
        table.providerUpdatedAt,
      )
      .where(sql`${table.webhookDeliveryId} is not null`),
    uniqueIndex('github_check_activity_fetch_unique')
      .on(
        table.organizationId,
        table.repositorySyncId,
        table.reconciliationFetchId,
        table.sourceKind,
        table.providerObjectId,
        table.providerUpdatedAt,
      )
      .where(sql`${table.reconciliationFetchId} is not null`),
    index('github_check_activity_head_idx').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
      table.createdAt,
    ),
    foreignKey({
      name: 'github_check_activity_repository_fk',
      columns: [table.organizationId, table.repositorySyncId],
      foreignColumns: [githubRepositorySync.organizationId, githubRepositorySync.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'github_check_activity_webhook_delivery_fk',
      columns: [table.organizationId, table.webhookDeliveryId],
      foreignColumns: [webhookDelivery.organizationId, webhookDelivery.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'github_check_activity_fetch_fk',
      columns: [
        table.organizationId,
        table.repositorySyncId,
        table.headSha,
        table.reconciliationFetchId,
      ],
      foreignColumns: [
        githubCheckReconciliationFetch.organizationId,
        githubCheckReconciliationFetch.repositorySyncId,
        githubCheckReconciliationFetch.headSha,
        githubCheckReconciliationFetch.id,
      ],
    }).onDelete('restrict'),
    check(
      'github_check_activity_source_kind_check',
      sql`${table.sourceKind} in ('check_run', 'commit_status')`,
    ),
    check(
      'github_check_activity_provenance_check',
      sql`(${table.webhookDeliveryId} is not null) <> (${table.reconciliationFetchId} is not null)`,
    ),
  ],
);

export const githubCheckHeadContext = pgTable(
  'github_check_head_context',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    headSha: text('head_sha').notNull(),
    contextKey: text('context_key').notNull(),
    sourceKind: text('source_kind').notNull(),
    state: text('state').notNull(),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }).notNull(),
    latestProviderObjectId: text('latest_provider_object_id').notNull(),
    latestProviderRunId: text('latest_provider_run_id'),
    active: boolean('active').notNull().default(true),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull().default(0),
    latestActivityId: text('latest_activity_id').notNull(),
    reconciliationState: text('reconciliation_state').notNull().default('resolved'),
    reconciliationAttempts: integer('reconciliation_attempts').notNull().default(0),
    reconciliationAvailableAt: timestamp('reconciliation_available_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    reconciliationClaimToken: text('reconciliation_claim_token'),
    reconciliationClaimedAt: timestamp('reconciliation_claimed_at', { withTimezone: true }),
    reconciliationLeaseExpiresAt: timestamp('reconciliation_lease_expires_at', {
      withTimezone: true,
    }),
    reconciliationClaimedVersion: bigint('reconciliation_claimed_version', { mode: 'number' }),
    reconciliationClaimedHeadGeneration: bigint('reconciliation_claimed_head_generation', {
      mode: 'number',
    }),
    lastReconciliationError: text('last_reconciliation_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('github_check_head_context_owner_id_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
      table.contextKey,
      table.id,
    ),
    uniqueIndex('github_check_head_context_unique').on(
      table.organizationId,
      table.repositorySyncId,
      table.headSha,
      table.contextKey,
    ),
    index('github_check_head_context_reconciliation_idx').on(
      table.reconciliationState,
      table.reconciliationAvailableAt,
    ),
    foreignKey({
      name: 'github_check_head_context_head_fk',
      columns: [table.organizationId, table.repositorySyncId, table.headSha],
      foreignColumns: [
        githubCheckHeadReconciliation.organizationId,
        githubCheckHeadReconciliation.repositorySyncId,
        githubCheckHeadReconciliation.headSha,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'github_check_head_context_activity_fk',
      columns: [
        table.organizationId,
        table.repositorySyncId,
        table.headSha,
        table.latestActivityId,
      ],
      foreignColumns: [
        githubCheckActivity.organizationId,
        githubCheckActivity.repositorySyncId,
        githubCheckActivity.headSha,
        githubCheckActivity.id,
      ],
    }).onDelete('restrict'),
    check(
      'github_check_head_context_source_kind_check',
      sql`${table.sourceKind} in ('check_run', 'commit_status')`,
    ),
    check(
      'github_check_head_context_reconciliation_state_check',
      sql`${table.reconciliationState} in ('resolved', 'unresolved', 'processing', 'failed', 'unavailable')`,
    ),
    check(
      'github_check_head_context_versions_check',
      sql`${table.contextVersion} >= 0 and ${table.reconciliationAttempts} >= 0`,
    ),
    check(
      'github_check_head_context_claim_check',
      sql`(
        ${table.reconciliationState} = 'processing'
        and ${table.reconciliationClaimToken} is not null
        and ${table.reconciliationClaimedAt} is not null
        and ${table.reconciliationLeaseExpiresAt} is not null
        and ${table.reconciliationClaimedVersion} is not null
        and ${table.reconciliationClaimedHeadGeneration} is not null
      ) or (
        ${table.reconciliationState} <> 'processing'
        and ${table.reconciliationClaimToken} is null
        and ${table.reconciliationClaimedAt} is null
        and ${table.reconciliationLeaseExpiresAt} is null
        and ${table.reconciliationClaimedVersion} is null
        and ${table.reconciliationClaimedHeadGeneration} is null
      )`,
    ),
  ],
);

export const githubPullRequestCheckContext = pgTable(
  'github_pull_request_check_context',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    pullRequestId: text('pull_request_id').notNull(),
    headContextId: text('head_context_id').notNull(),
    headSha: text('head_sha').notNull(),
    contextKey: text('context_key').notNull(),
    capturedHeadEpoch: bigint('captured_head_epoch', { mode: 'number' }).notNull(),
    projectedContextVersion: bigint('projected_context_version', { mode: 'number' }).notNull(),
    projectedState: text('projected_state').notNull(),
    latestActivityId: text('latest_activity_id').notNull(),
    notificationSourceEventId: text('notification_source_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_pull_request_check_context_unique').on(
      table.organizationId,
      table.pullRequestId,
      table.capturedHeadEpoch,
      table.contextKey,
    ),
    index('github_pull_request_check_context_current_idx').on(
      table.organizationId,
      table.pullRequestId,
      table.capturedHeadEpoch,
      table.headSha,
    ),
    foreignKey({
      name: 'github_pull_request_check_context_pull_request_fk',
      columns: [table.organizationId, table.repositorySyncId, table.pullRequestId],
      foreignColumns: [
        githubPullRequest.organizationId,
        githubPullRequest.repositorySyncId,
        githubPullRequest.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'github_pull_request_check_context_head_context_fk',
      columns: [
        table.organizationId,
        table.repositorySyncId,
        table.headSha,
        table.contextKey,
        table.headContextId,
      ],
      foreignColumns: [
        githubCheckHeadContext.organizationId,
        githubCheckHeadContext.repositorySyncId,
        githubCheckHeadContext.headSha,
        githubCheckHeadContext.contextKey,
        githubCheckHeadContext.id,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'github_pull_request_check_context_activity_fk',
      columns: [
        table.organizationId,
        table.repositorySyncId,
        table.headSha,
        table.latestActivityId,
      ],
      foreignColumns: [
        githubCheckActivity.organizationId,
        githubCheckActivity.repositorySyncId,
        githubCheckActivity.headSha,
        githubCheckActivity.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'github_pull_request_check_context_source_event_fk',
      columns: [table.organizationId, table.notificationSourceEventId],
      foreignColumns: [notificationSourceEvent.organizationId, notificationSourceEvent.id],
    }).onDelete('restrict'),
    check(
      'github_pull_request_check_context_versions_check',
      sql`${table.capturedHeadEpoch} >= 0 and ${table.projectedContextVersion} >= 0`,
    ),
  ],
);

export const githubPullRequestReconciliation = pgTable(
  'github_pull_request_reconciliation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    repositorySyncId: text('repository_sync_id').notNull(),
    pullRequestId: text('pull_request_id').notNull(),
    status: text('status').notNull().default('pending'),
    jobVersion: bigint('job_version', { mode: 'number' }).notNull().default(0),
    capturedHeadEpoch: bigint('captured_head_epoch', { mode: 'number' }).notNull(),
    conflictingHeadShas: jsonb('conflicting_head_shas').$type<string[]>().notNull().default([]),
    conflictingProviderUpdatedAt: timestamp('conflicting_provider_updated_at', {
      withTimezone: true,
    }).notNull(),
    triggerIdentity: text('trigger_identity').notNull(),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimToken: text('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    claimedJobVersion: bigint('claimed_job_version', { mode: 'number' }),
    claimedHeadEpoch: bigint('claimed_head_epoch', { mode: 'number' }),
    resolvedHeadSha: text('resolved_head_sha'),
    resolvedProviderUpdatedAt: timestamp('resolved_provider_updated_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_pull_request_reconciliation_pull_unique').on(
      table.organizationId,
      table.pullRequestId,
    ),
    index('github_pull_request_reconciliation_pending_idx').on(table.status, table.availableAt),
    foreignKey({
      name: 'github_pull_request_reconciliation_pull_request_fk',
      columns: [table.organizationId, table.repositorySyncId, table.pullRequestId],
      foreignColumns: [
        githubPullRequest.organizationId,
        githubPullRequest.repositorySyncId,
        githubPullRequest.id,
      ],
    }).onDelete('cascade'),
    check(
      'github_pull_request_reconciliation_status_check',
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed', 'unavailable')`,
    ),
    check(
      'github_pull_request_reconciliation_versions_check',
      sql`${table.jobVersion} >= 0 and ${table.capturedHeadEpoch} >= 0 and ${table.attempts} >= 0`,
    ),
    check(
      'github_pull_request_reconciliation_conflicts_check',
      sql`jsonb_typeof(${table.conflictingHeadShas}) = 'array'`,
    ),
    check(
      'github_pull_request_reconciliation_claim_check',
      sql`(
        ${table.status} = 'processing'
        and ${table.claimToken} is not null
        and ${table.claimedAt} is not null
        and ${table.leaseExpiresAt} is not null
        and ${table.claimedJobVersion} is not null
        and ${table.claimedHeadEpoch} is not null
      ) or (
        ${table.status} <> 'processing'
        and ${table.claimToken} is null
        and ${table.claimedAt} is null
        and ${table.leaseExpiresAt} is null
        and ${table.claimedJobVersion} is null
        and ${table.claimedHeadEpoch} is null
      )`,
    ),
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

export const slackUserMapping = pgTable(
  'slack_user_mapping',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    slackUserId: text('slack_user_id').notNull(),
    slackDisplayName: text('slack_display_name').notNull().default(''),
    slackChannelId: text('slack_channel_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('slack_user_mapping_user_unique').on(table.integrationId, table.userId),
    uniqueIndex('slack_user_mapping_slack_user_unique').on(table.integrationId, table.slackUserId),
    index('slack_user_mapping_org_idx').on(table.organizationId),
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
    pullRequestId: text('pull_request_id').references(() => githubPullRequest.id, {
      onDelete: 'set null',
    }),
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
    index('git_link_pull_request_idx').on(table.pullRequestId),
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
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('received'),
    error: text('error'),
    claimToken: text('claim_token'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('webhook_delivery_org_id_unique').on(table.organizationId, table.id),
    uniqueIndex('webhook_delivery_unique').on(table.provider, table.deliveryId),
    index('webhook_delivery_org_idx').on(table.organizationId, table.createdAt),
  ],
);

export const webhookDeliveryQuarantine = pgTable(
  'webhook_delivery_quarantine',
  {
    deliveryId: text('delivery_id')
      .primaryKey()
      .references(() => webhookDelivery.id, { onDelete: 'restrict' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    scopeKind: text('scope_kind').notNull(),
    scopeKeyHash: text('scope_key_hash').notNull(),
    payloadEnvelope: jsonb('payload_envelope').$type<Record<string, unknown>>(),
    encryptionKeyVersion: integer('encryption_key_version').notNull(),
    parserSchemaVersion: integer('parser_schema_version').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonPath: text('reason_path').notNull(),
    diagnostics: jsonb('diagnostics').$type<Record<string, unknown>>().notNull().default({}),
    disposition: text('disposition').notNull().default('awaiting_resolution'),
    replayRequestId: text('replay_request_id'),
    replayRequestedBy: text('replay_requested_by'),
    replayRequestedAt: timestamp('replay_requested_at', { withTimezone: true }),
    replayClaimToken: text('replay_claim_token'),
    replayClaimedAt: timestamp('replay_claimed_at', { withTimezone: true }),
    replayLeaseExpiresAt: timestamp('replay_lease_expires_at', { withTimezone: true }),
    replacementDeliveryId: text('replacement_delivery_id').references(() => webhookDelivery.id, {
      onDelete: 'restrict',
    }),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ciphertextClearedAt: timestamp('ciphertext_cleared_at', { withTimezone: true }),
    quarantinedAt: timestamp('quarantined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('webhook_delivery_quarantine_replacement_unique')
      .on(table.replacementDeliveryId)
      .where(sql`${table.replacementDeliveryId} is not null`),
    uniqueIndex('webhook_delivery_quarantine_replay_request_unique')
      .on(table.replayRequestId)
      .where(sql`${table.replayRequestId} is not null`),
    index('webhook_delivery_quarantine_scope_idx').on(
      table.scopeKind,
      table.scopeKeyHash,
      table.quarantinedAt,
    ),
    check(
      'webhook_delivery_quarantine_scope_kind_check',
      sql`${table.scopeKind} in ('organization', 'unresolved')`,
    ),
    check(
      'webhook_delivery_quarantine_disposition_check',
      sql`${table.disposition} in ('awaiting_resolution', 'replay_pending', 'replayed', 'resolved', 'organization_deleted', 'expired')`,
    ),
    check(
      'webhook_delivery_quarantine_versions_check',
      sql`${table.encryptionKeyVersion} > 0 and ${table.parserSchemaVersion} > 0`,
    ),
    check(
      'webhook_delivery_quarantine_payload_retention_check',
      sql`${table.payloadEnvelope} is not null or ${table.ciphertextClearedAt} is not null`,
    ),
  ],
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

export const webVital = pgTable(
  'web_vital',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    route: text('route').notNull(),
    metric: text('metric').notNull(),
    value: doublePrecision('value').notNull(),
    rating: text('rating').notNull(),
    navigationType: text('navigation_type').notNull().default(''),
    interactionType: text('interaction_type'),
    target: text('target'),
    parts: jsonb('parts'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('web_vital_org_metric_idx').on(table.organizationId, table.metric, table.createdAt),
    index('web_vital_route_idx').on(table.organizationId, table.route, table.metric),
  ],
);
