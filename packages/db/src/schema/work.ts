import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization, team } from './org.ts';

export const workflowState = pgTable(
  'workflow_state',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull(),
    color: text('color').notNull(),
    position: integer('position').notNull().default(0),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_state_team_idx').on(table.teamId, table.position),
    uniqueIndex('workflow_state_team_name_unique').on(table.teamId, table.name),
  ],
);

export const label = pgTable(
  'label',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('label_org_idx').on(table.organizationId),
    uniqueIndex('label_team_name_unique')
      .on(table.organizationId, table.teamId, table.name)
      .where(sql`${table.teamId} is not null`),
    uniqueIndex('label_org_name_unique')
      .on(table.organizationId, table.name)
      .where(sql`${table.teamId} is null`),
  ],
);

export const estimateScale = pgTable(
  'estimate_scale',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('points'),
    isDefault: boolean('is_default').notNull().default(false),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('estimate_scale_org_idx').on(table.organizationId),
    uniqueIndex('estimate_scale_org_name_active_unique')
      .on(table.organizationId, table.name)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const estimatePoint = pgTable(
  'estimate_point',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    scaleId: text('scale_id')
      .notNull()
      .references(() => estimateScale.id, { onDelete: 'cascade' }),
    key: integer('key').notNull(),
    value: doublePrecision('value').notNull().default(0),
    label: text('label').notNull().default(''),
    position: integer('position').notNull().default(0),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('estimate_point_scale_key_unique').on(table.scaleId, table.key),
    index('estimate_point_scale_idx').on(table.scaleId, table.position),
  ],
);

export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary').notNull().default(''),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('backlog'),
    health: text('health').notNull().default('no_update'),
    icon: text('icon').notNull().default('box'),
    color: text('color').notNull().default('#5A63C8'),
    leadId: text('lead_id').references(() => user.id, { onDelete: 'set null' }),
    estimateScaleId: text('estimate_scale_id').references(() => estimateScale.id, {
      onDelete: 'set null',
    }),
    startDate: date('start_date'),
    targetDate: date('target_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(1024),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('project_org_slug_active_unique')
      .on(table.organizationId, table.slug)
      .where(sql`${table.archivedAt} is null`),
    index('project_org_idx').on(table.organizationId),
  ],
);

export const projectTeam = pgTable(
  'project_team',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('project_team_unique').on(table.projectId, table.teamId),
    index('project_team_team_idx').on(table.teamId),
  ],
);

export const projectUpdate = pgTable(
  'project_update',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    health: text('health').notNull(),
    body: text('body').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('project_update_project_idx').on(table.projectId, table.createdAt)],
);

export const milestone = pgTable(
  'milestone',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    targetDate: date('target_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(1024),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('milestone_project_idx').on(table.projectId, table.sortOrder)],
);

export const cycle = pgTable(
  'cycle',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name').notNull().default(''),
    timezone: text('timezone').notNull().default('UTC'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    progressSnapshot: jsonb('progress_snapshot').$type<Record<string, unknown>>(),
    version: smallint('version').notNull().default(0),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('cycle_team_number_unique').on(table.teamId, table.number),
    index('cycle_team_dates_idx').on(table.teamId, table.startsAt),
  ],
);

export const cycleProgressSnapshot = pgTable(
  'cycle_progress_snapshot',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycle.id, { onDelete: 'cascade' }),
    capturedOn: date('captured_on').notNull(),
    totalIssues: integer('total_issues').notNull().default(0),
    backlogIssues: integer('backlog_issues').notNull().default(0),
    unstartedIssues: integer('unstarted_issues').notNull().default(0),
    startedIssues: integer('started_issues').notNull().default(0),
    completedIssues: integer('completed_issues').notNull().default(0),
    canceledIssues: integer('canceled_issues').notNull().default(0),
    totalEstimate: doublePrecision('total_estimate').notNull().default(0),
    completedEstimate: doublePrecision('completed_estimate').notNull().default(0),
    breakdown: jsonb('breakdown').$type<Record<string, unknown>>().notNull().default({}),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('cycle_progress_snapshot_unique').on(table.cycleId, table.capturedOn)],
);

export const module = pgTable(
  'module',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('backlog'),
    leadId: text('lead_id').references(() => user.id, { onDelete: 'set null' }),
    startDate: date('start_date'),
    targetDate: date('target_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(1024),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('module_team_idx').on(table.teamId, table.sortOrder),
    index('module_project_idx').on(table.projectId),
    uniqueIndex('module_team_name_active_unique')
      .on(table.teamId, table.name)
      .where(sql`${table.archivedAt} is null`),
  ],
);

export const moduleMember = pgTable(
  'module_member',
  {
    id: text('id').primaryKey(),
    moduleId: text('module_id')
      .notNull()
      .references(() => module.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('module_member_unique').on(table.moduleId, table.userId),
    index('module_member_user_idx').on(table.userId),
  ],
);

export const issue = pgTable(
  'issue',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    identifier: text('identifier').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    stateId: text('state_id')
      .notNull()
      .references(() => workflowState.id, { onDelete: 'restrict' }),
    priority: smallint('priority').notNull().default(0),
    creatorId: text('creator_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
    cycleId: text('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    parentId: text('parent_id').references((): AnyPgColumn => issue.id, { onDelete: 'set null' }),
    estimate: smallint('estimate'),
    estimatePointId: text('estimate_point_id').references(() => estimatePoint.id, {
      onDelete: 'set null',
    }),
    dueDate: date('due_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(1024),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    stateEnteredAt: timestamp('state_entered_at', { withTimezone: true }).notNull().defaultNow(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('issue_team_number_unique').on(table.teamId, table.number),
    uniqueIndex('issue_org_identifier_unique').on(table.organizationId, table.identifier),
    index('issue_board_idx').on(table.teamId, table.stateId, table.sortOrder),
    index('issue_assignee_idx').on(table.assigneeId, table.updatedAt),
    index('issue_project_idx').on(table.projectId),
    index('issue_cycle_idx').on(table.cycleId),
    index('issue_parent_idx').on(table.parentId),
    index('issue_sync_idx').on(table.organizationId, table.syncId),
    index('issue_team_order_idx')
      .on(table.teamId, table.sortOrder, table.id)
      .where(sql`${table.archivedAt} is null`),
    index('issue_team_updated_idx')
      .on(table.teamId, table.updatedAt)
      .where(sql`${table.archivedAt} is null`),
    index('issue_team_created_idx')
      .on(table.teamId, table.createdAt)
      .where(sql`${table.archivedAt} is null`),
    index('issue_milestone_idx').on(table.milestoneId).where(sql`${table.archivedAt} is null`),
    index('issue_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
    index('issue_description_trgm_idx').using('gin', table.description.op('gin_trgm_ops')),
  ],
);

export const moduleIssue = pgTable(
  'module_issue',
  {
    id: text('id').primaryKey(),
    moduleId: text('module_id')
      .notNull()
      .references(() => module.id, { onDelete: 'cascade' }),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('module_issue_unique').on(table.moduleId, table.issueId),
    index('module_issue_issue_idx').on(table.issueId),
  ],
);

export const moduleLink = pgTable(
  'module_link',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    moduleId: text('module_id')
      .notNull()
      .references(() => module.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    url: text('url').notNull(),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('module_link_module_idx').on(table.moduleId)],
);

export const issueIdentifierAlias = pgTable(
  'issue_identifier_alias',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    identifier: text('identifier').notNull(),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('issue_identifier_alias_unique').on(table.organizationId, table.identifier),
    index('issue_identifier_alias_issue_idx').on(table.issueId),
  ],
);

export const intake = pgTable(
  'intake',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Intake'),
    enabled: boolean('enabled').notNull().default(true),
    anchor: text('anchor'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('intake_team_unique').on(table.teamId),
    uniqueIndex('intake_anchor_unique').on(table.anchor),
  ],
);

export const intakeIssue = pgTable(
  'intake_issue',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    intakeId: text('intake_id')
      .notNull()
      .references(() => intake.id, { onDelete: 'cascade' }),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    source: text('source').notNull().default('in_app'),
    sourceEmail: text('source_email'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    duplicateOfId: text('duplicate_of_id').references((): AnyPgColumn => issue.id, {
      onDelete: 'set null',
    }),
    triagedById: text('triaged_by_id').references(() => user.id, { onDelete: 'set null' }),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('intake_issue_unique').on(table.intakeId, table.issueId),
    index('intake_issue_status_idx').on(table.intakeId, table.status),
  ],
);

export const issueLabel = pgTable(
  'issue_label',
  {
    id: text('id').primaryKey(),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('issue_label_unique').on(table.issueId, table.labelId),
    index('issue_label_label_idx').on(table.labelId),
  ],
);

export const issueRelation = pgTable(
  'issue_relation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    relatedIssueId: text('related_issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('issue_relation_unique').on(table.issueId, table.relatedIssueId, table.type),
    index('issue_relation_issue_idx').on(table.issueId),
  ],
);

export const issueSubscription = pgTable(
  'issue_subscription',
  {
    id: text('id').primaryKey(),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('issue_subscription_unique').on(table.issueId, table.userId)],
);

export const issueActivity = pgTable(
  'issue_activity',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull().default('user'),
    actorId: text('actor_id').notNull(),
    actorName: text('actor_name').notNull(),
    field: text('field').notNull(),
    fromValue: jsonb('from_value'),
    toValue: jsonb('to_value'),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('issue_activity_issue_idx').on(table.issueId, table.createdAt)],
);

export const view = pgTable(
  'view',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filter: jsonb('filter').$type<Record<string, unknown>>().notNull().default({}),
    layout: text('layout').notNull().default('list'),
    groupBy: text('group_by').notNull().default('state'),
    shared: text('shared').notNull().default('false'),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('view_org_idx').on(table.organizationId)],
);

export const savedAnalyticsView = pgTable(
  'saved_analytics_view',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    scopeType: text('scope_type').notNull().default('workspace'),
    scopeId: text('scope_id'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    shared: boolean('shared').notNull().default(false),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('saved_analytics_view_org_idx').on(table.organizationId),
    index('saved_analytics_view_owner_idx').on(table.ownerId),
  ],
);
