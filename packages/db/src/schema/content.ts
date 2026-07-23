import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth.ts';
import { organization } from './org.ts';
import { issue, project } from './work.ts';

export const comment = pgTable(
  'comment',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    issueId: text('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    parentId: text('parent_id'),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('comment_issue_idx').on(table.issueId, table.createdAt),
    index('comment_parent_idx').on(table.parentId),
  ],
);

export const reaction = pgTable(
  'reaction',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    commentId: text('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
    issueId: text('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reaction_comment_unique').on(table.commentId, table.userId, table.emoji),
    uniqueIndex('reaction_issue_unique').on(table.issueId, table.userId, table.emoji),
    index('reaction_comment_idx').on(table.commentId),
    index('reaction_issue_idx').on(table.issueId),
    check('reaction_one_parent', sql`num_nonnulls(${table.commentId}, ${table.issueId}) = 1`),
  ],
);

export const docCollection = pgTable(
  'doc_collection',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('book'),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('doc_collection_org_idx').on(table.organizationId)],
);

export const doc = pgTable(
  'doc',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id').references(() => docCollection.id, {
      onDelete: 'set null',
    }),
    parentId: text('parent_id').references((): AnyPgColumn => doc.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    visibility: text('visibility').notNull().default('workspace'),
    publishToken: text('publish_token').unique(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    repoBinding: jsonb('repo_binding').$type<{
      repo: string;
      path: string;
      branch: string;
      syncedAt: string;
    } | null>(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    index('doc_org_idx').on(table.organizationId),
    index('doc_project_idx').on(table.projectId),
    index('doc_parent_idx').on(table.parentId),
    index('doc_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
    index('doc_content_trgm_idx').using('gin', table.content.op('gin_trgm_ops')),
  ],
);

export const docVersion = pgTable(
  'doc_version',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    docId: text('doc_id')
      .notNull()
      .references(() => doc.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('doc_version_unique').on(table.docId, table.version),
    index('doc_version_doc_idx').on(table.docId, table.createdAt),
  ],
);

export const attachment = pgTable(
  'attachment',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    parentType: text('parent_type').notNull(),
    parentId: text('parent_id').notNull(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    status: text('status').notNull().default('pending'),
    width: bigint('width', { mode: 'number' }),
    height: bigint('height', { mode: 'number' }),
    durationSeconds: bigint('duration_seconds', { mode: 'number' }),
    uploadedById: text('uploaded_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('attachment_parent_idx').on(table.parentType, table.parentId)],
);

export const favorite = pgTable(
  'favorite',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    sortOrder: doublePrecision('sort_order').notNull().default(1024),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('favorite_unique').on(table.userId, table.entityType, table.entityId),
    index('favorite_user_idx').on(table.userId, table.sortOrder),
  ],
);

export const recentVisit = pgTable(
  'recent_visit',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull().defaultNow(),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('recent_visit_unique').on(
      table.userId,
      table.organizationId,
      table.entityType,
      table.entityId,
    ),
    index('recent_visit_user_idx').on(table.userId, table.visitedAt),
  ],
);

export const homeWidgetPreference = pgTable(
  'home_widget_preference',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    widget: text('widget').notNull(),
    position: integer('position').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    syncId: bigint('sync_id', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('home_widget_preference_unique').on(
      table.userId,
      table.organizationId,
      table.widget,
    ),
  ],
);

export const docSubscription = pgTable(
  'doc_subscription',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => doc.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    muted: boolean('muted').notNull().default(false),
  },
  (table) => [uniqueIndex('doc_subscription_unique').on(table.docId, table.userId)],
);
