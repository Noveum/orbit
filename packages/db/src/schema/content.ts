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
      .references(() => user.id, { onDelete: 'cascade' }),
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
    unique('reaction_comment_unique').on(table.commentId, table.userId, table.emoji),
    index('reaction_comment_idx').on(table.commentId),
    index('reaction_issue_idx').on(table.issueId),
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
    projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    visibility: text('visibility').notNull().default('workspace'),
    publishToken: text('publish_token').unique(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
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
      .references(() => user.id, { onDelete: 'cascade' }),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('favorite_unique').on(table.userId, table.entityType, table.entityId)],
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
  (table) => [unique('doc_subscription_unique').on(table.docId, table.userId)],
);
