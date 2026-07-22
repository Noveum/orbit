import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
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
    unique('workflow_state_team_name_unique').on(table.teamId, table.name),
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
  (table) => [index('label_org_idx').on(table.organizationId)],
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
    startDate: date('start_date'),
    targetDate: date('target_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(1024),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    unique('project_org_slug_unique').on(table.organizationId, table.slug),
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
  (table) => [unique('project_team_unique').on(table.projectId, table.teamId)],
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
      .references(() => user.id, { onDelete: 'cascade' }),
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
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('cycle_team_number_unique').on(table.teamId, table.number),
    index('cycle_team_dates_idx').on(table.teamId, table.startsAt),
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
      .references(() => user.id, { onDelete: 'cascade' }),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
    milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
    cycleId: text('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    parentId: text('parent_id'),
    estimate: smallint('estimate'),
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
    unique('issue_team_number_unique').on(table.teamId, table.number),
    unique('issue_org_identifier_unique').on(table.organizationId, table.identifier),
    index('issue_board_idx').on(table.teamId, table.stateId, table.sortOrder),
    index('issue_assignee_idx').on(table.assigneeId, table.updatedAt),
    index('issue_project_idx').on(table.projectId),
    index('issue_cycle_idx').on(table.cycleId),
    index('issue_parent_idx').on(table.parentId),
    index('issue_sync_idx').on(table.organizationId, table.syncId),
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
    unique('issue_label_unique').on(table.issueId, table.labelId),
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
    unique('issue_relation_unique').on(table.issueId, table.relatedIssueId, table.type),
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
  (table) => [unique('issue_subscription_unique').on(table.issueId, table.userId)],
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
