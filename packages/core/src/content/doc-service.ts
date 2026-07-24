import { and, asc, count, db, desc, eq, ilike, isNull, ne, or, schema, sql } from '@orbit/db';
import { conflict, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { slugify } from '@orbit/shared/utils';
import {
  docCollectionCreateSchema,
  docCollectionUpdateSchema,
  docCreateSchema,
  docFilterSchema,
  docShareSchema,
  docUpdateSchema,
} from '@orbit/shared/validators';
import { getTableColumns } from 'drizzle-orm';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, newToken, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

const DOC_EXCERPT_LENGTH = 400;
const DOC_LIST_LIMIT = 500;

export type DocRow = typeof schema.doc.$inferSelect;
export type DocCollectionRow = typeof schema.docCollection.$inferSelect;
export type DocVersionRow = typeof schema.docVersion.$inferSelect;
export type AttachmentRow = typeof schema.attachment.$inferSelect;

const MAX_DEPTH = 32;
const VERSION_COALESCE_MS = 5 * 60 * 1000;

export function docSlug(title: string): string {
  const base = slugify(title);
  return base.length === 0 ? 'doc' : base;
}

export function publishedDocToken(pathSegment: string): string {
  const trimmed = pathSegment.trim();
  const dash = trimmed.lastIndexOf('-');
  return dash === -1 ? trimmed : trimmed.slice(dash + 1);
}

export interface DocAuthor {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface DocBacklink {
  readonly id: string;
  readonly title: string;
}

export interface DocDetail {
  readonly doc: DocRow;
  readonly attachments: AttachmentRow[];
  readonly author: DocAuthor;
  readonly followers: number;
  readonly backlinks: DocBacklink[];
}

export interface SavedDoc {
  readonly doc: DocRow;
  readonly actions: SyncAction[];
}

export interface SavedDocCollection {
  readonly collection: DocCollectionRow;
  readonly actions: SyncAction[];
}

function docScopes(row: DocRow): string[] {
  const list = [scopes.organization(row.organizationId), scopes.doc(row.id)];
  if (row.projectId !== null) list.push(scopes.project(row.projectId));
  return list;
}

function docAction(
  row: DocRow,
  syncId: number,
  actor: Awaited<ReturnType<typeof principalActor>>,
  action: 'insert' | 'update' | 'delete' | 'archive',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: docScopes(row),
    action,
    model: 'doc',
    modelId: row.id,
    data: { ...row, publishToken: row.publishToken === null ? null : 'redacted' },
    actor,
  });
}

function tokenFor(visibility: string, current: string | null): string | null {
  if (visibility === 'workspace') return null;
  return current ?? newToken();
}

async function loadDoc(executor: Executor, principal: Principal, docId: string): Promise<DocRow> {
  const [row] = await executor
    .select()
    .from(schema.doc)
    .where(and(eq(schema.doc.id, docId), eq(schema.doc.organizationId, principal.organizationId)))
    .limit(1);
  return requireRow(row, 'That doc does not exist.');
}

async function assertParent(
  executor: Executor,
  principal: Principal,
  docId: string | null,
  parentId: string,
): Promise<void> {
  if (docId !== null && parentId === docId) throw validationFailed('A doc cannot nest in itself.');

  let cursor: string | null = parentId;
  for (let depth = 0; depth < MAX_DEPTH && cursor !== null; depth += 1) {
    const rows: { id: string; parentId: string | null }[] = await executor
      .select({ id: schema.doc.id, parentId: schema.doc.parentId })
      .from(schema.doc)
      .where(
        and(eq(schema.doc.id, cursor), eq(schema.doc.organizationId, principal.organizationId)),
      )
      .limit(1);
    const parent = requireRow(rows[0], 'That parent doc does not exist.');
    if (docId !== null && parent.parentId === docId) {
      throw validationFailed('A doc cannot nest inside its own child.');
    }
    cursor = parent.parentId;
  }
}

async function assertPlacement(
  executor: Executor,
  principal: Principal,
  placement: {
    collectionId?: string | null | undefined;
    projectId?: string | null | undefined;
    parentId?: string | null | undefined;
  },
  docId: string | null = null,
): Promise<void> {
  const parentId = placement.parentId;
  if (parentId !== undefined && parentId !== null) {
    await assertParent(executor, principal, docId, parentId);
  }

  const collectionId = placement.collectionId;
  if (collectionId !== undefined && collectionId !== null) {
    const [row] = await executor
      .select({ id: schema.docCollection.id })
      .from(schema.docCollection)
      .where(
        and(
          eq(schema.docCollection.id, collectionId),
          eq(schema.docCollection.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    requireRow(row, 'That collection does not exist.');
  }

  const projectId = placement.projectId;
  if (projectId !== undefined && projectId !== null) {
    const [row] = await executor
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.id, projectId),
          eq(schema.project.organizationId, principal.organizationId),
        ),
      )
      .limit(1);
    requireRow(row, 'That project does not exist.');
  }
}

export interface DocListRow extends Omit<DocRow, 'content'> {
  readonly content: string;
  readonly excerpt: string;
}

const DOC_LIST_COLUMNS = {
  ...getTableColumns(schema.doc),
  content: sql<string>`''`,
  excerpt: sql<string>`left(${schema.doc.content}, ${DOC_EXCERPT_LENGTH})`,
};

export async function listDocs(principal: Principal, input: unknown = {}): Promise<DocListRow[]> {
  assertCan(principal, 'doc:read');
  const filter = docFilterSchema.parse(input);

  const conditions = [eq(schema.doc.organizationId, principal.organizationId)];
  if (!filter.includeArchived) conditions.push(isNull(schema.doc.archivedAt));
  if (filter.collectionId !== undefined) {
    conditions.push(eq(schema.doc.collectionId, filter.collectionId));
  }
  if (filter.projectId !== undefined) conditions.push(eq(schema.doc.projectId, filter.projectId));
  if (filter.query !== undefined && filter.query.length > 0) {
    const pattern = `%${filter.query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
    const match = or(ilike(schema.doc.title, pattern), ilike(schema.doc.content, pattern));
    if (match !== undefined) conditions.push(match);
  }

  return await db
    .select(DOC_LIST_COLUMNS)
    .from(schema.doc)
    .where(and(...conditions))
    .orderBy(desc(schema.doc.updatedAt))
    .limit(DOC_LIST_LIMIT);
}

export async function listDocCollections(principal: Principal): Promise<DocCollectionRow[]> {
  assertCan(principal, 'doc:read');
  return await db
    .select()
    .from(schema.docCollection)
    .where(eq(schema.docCollection.organizationId, principal.organizationId))
    .orderBy(asc(schema.docCollection.name));
}

async function attachmentsFor(docId: string): Promise<AttachmentRow[]> {
  return await db
    .select()
    .from(schema.attachment)
    .where(and(eq(schema.attachment.parentType, 'doc'), eq(schema.attachment.parentId, docId)))
    .orderBy(asc(schema.attachment.createdAt));
}

export async function listDocBacklinks(doc: DocRow): Promise<DocBacklink[]> {
  return await db
    .select({ id: schema.doc.id, title: schema.doc.title })
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.organizationId, doc.organizationId),
        isNull(schema.doc.archivedAt),
        ne(schema.doc.id, doc.id),
        ilike(schema.doc.content, `%/docs/${doc.id}%`),
      ),
    )
    .orderBy(asc(schema.doc.title))
    .limit(50);
}

async function detailFor(doc: DocRow): Promise<DocDetail> {
  const [author] = await db
    .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, doc.authorId))
    .limit(1);
  const [followers] = await db
    .select({ total: count() })
    .from(schema.docSubscription)
    .where(eq(schema.docSubscription.docId, doc.id));

  return {
    doc,
    attachments: await attachmentsFor(doc.id),
    author: author ?? { id: doc.authorId, name: 'Someone', image: null },
    followers: followers?.total ?? 0,
    backlinks: await listDocBacklinks(doc),
  };
}

export async function getDoc(principal: Principal, docId: string): Promise<DocDetail> {
  assertCan(principal, 'doc:read');
  return await detailFor(await loadDoc(db, principal, docId));
}

export async function getPublishedDoc(pathSegment: string): Promise<DocDetail | null> {
  const token = publishedDocToken(pathSegment);
  if (token.length === 0) return null;
  const [doc] = await db
    .select()
    .from(schema.doc)
    .where(and(eq(schema.doc.publishToken, token), isNull(schema.doc.archivedAt)))
    .limit(1);
  if (doc === undefined) return null;
  if (doc.visibility === 'workspace') return null;
  return await detailFor(doc);
}

export async function listPublicDocs(): Promise<DocRow[]> {
  return await db
    .select()
    .from(schema.doc)
    .where(
      and(
        eq(schema.doc.visibility, 'public'),
        isNull(schema.doc.archivedAt),
        ne(schema.doc.publishToken, ''),
      ),
    )
    .orderBy(desc(schema.doc.updatedAt))
    .limit(5000);
}

export async function isPublishedDoc(docId: string): Promise<boolean> {
  const [row] = await db
    .select({ visibility: schema.doc.visibility, archivedAt: schema.doc.archivedAt })
    .from(schema.doc)
    .where(eq(schema.doc.id, docId))
    .limit(1);
  return row !== undefined && row.archivedAt === null && row.visibility !== 'workspace';
}

export async function createDoc(principal: Principal, input: unknown): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');
  const parsed = docCreateSchema.parse(input);
  if (parsed.visibility !== 'workspace') assertCan(principal, 'doc:publish');

  return await db.transaction(async (tx) => {
    await assertPlacement(tx, principal, parsed);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.doc)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        collectionId: parsed.collectionId,
        projectId: parsed.projectId,
        parentId: parsed.parentId,
        title: parsed.title,
        slug: docSlug(parsed.title),
        content: parsed.content,
        visibility: parsed.visibility,
        publishToken: tokenFor(parsed.visibility, null),
        authorId: principal.userId,
        syncId,
      })
      .returning();
    const doc = requireRow(created, 'The doc could not be created.');

    await tx
      .insert(schema.docSubscription)
      .values({ id: newId(), docId: doc.id, userId: principal.userId })
      .onConflictDoNothing();
    await snapshotVersion(tx, principal, doc, null);

    return { doc, actions: [docAction(doc, syncId, actor, 'insert')] };
  });
}

async function snapshotVersion(
  executor: Executor,
  principal: Principal,
  doc: DocRow,
  restoredFromId: string | null,
): Promise<void> {
  const now = new Date();
  if (restoredFromId === null) {
    const [latest] = await executor
      .select()
      .from(schema.docVersion)
      .where(eq(schema.docVersion.docId, doc.id))
      .orderBy(desc(schema.docVersion.lastSavedAt))
      .limit(1);

    if (latest !== undefined && latest.title === doc.title && latest.content === doc.content) {
      return;
    }
    if (
      latest !== undefined &&
      latest.ownedById === principal.userId &&
      now.getTime() - latest.lastSavedAt.getTime() < VERSION_COALESCE_MS
    ) {
      await executor
        .update(schema.docVersion)
        .set({ title: doc.title, content: doc.content, lastSavedAt: now })
        .where(eq(schema.docVersion.id, latest.id));
      return;
    }
  }

  await executor.insert(schema.docVersion).values({
    id: newId(),
    docId: doc.id,
    organizationId: doc.organizationId,
    title: doc.title,
    content: doc.content,
    ownedById: principal.userId,
    restoredFromId,
    lastSavedAt: now,
  });
}

export async function updateDoc(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');
  const parsed = docUpdateSchema.parse(input);
  if (parsed.visibility !== undefined && parsed.visibility !== 'workspace') {
    assertCan(principal, 'doc:publish');
  }

  return await db.transaction(async (tx) => {
    const current = await loadDoc(tx, principal, docId);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');
    await assertPlacement(tx, principal, parsed, docId);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        ...parsed,
        ...(current.slug.length === 0 ? { slug: docSlug(parsed.title ?? current.title) } : {}),
        ...(parsed.visibility === undefined
          ? {}
          : { publishToken: tokenFor(parsed.visibility, current.publishToken) }),
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning();
    const doc = requireRow(saved, 'That doc does not exist.');
    if (doc.title !== current.title || doc.content !== current.content) {
      await snapshotVersion(tx, principal, doc, null);
    }

    return { doc, actions: [docAction(doc, syncId, actor, 'update')] };
  });
}

export async function listDocVersions(
  principal: Principal,
  docId: string,
): Promise<DocVersionRow[]> {
  assertCan(principal, 'doc:read');
  await loadDoc(db, principal, docId);
  return await db
    .select()
    .from(schema.docVersion)
    .where(eq(schema.docVersion.docId, docId))
    .orderBy(desc(schema.docVersion.lastSavedAt))
    .limit(100);
}

export async function restoreDocVersion(
  principal: Principal,
  docId: string,
  versionId: string,
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');

  return await db.transaction(async (tx) => {
    const current = await loadDoc(tx, principal, docId);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');

    const [found] = await tx
      .select()
      .from(schema.docVersion)
      .where(and(eq(schema.docVersion.id, versionId), eq(schema.docVersion.docId, docId)))
      .limit(1);
    const version = requireRow(found, 'That version does not exist.');

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        title: version.title,
        content: version.content,
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning();
    const doc = requireRow(saved, 'That doc does not exist.');
    await snapshotVersion(tx, principal, doc, version.id);

    return { doc, actions: [docAction(doc, syncId, actor, 'update')] };
  });
}

export async function archiveDoc(
  principal: Principal,
  docId: string,
  archived = true,
): Promise<SavedDoc> {
  assertCan(principal, 'doc:write');

  return await db.transaction(async (tx) => {
    await loadDoc(tx, principal, docId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date(), syncId })
      .where(eq(schema.doc.id, docId))
      .returning();
    const doc = requireRow(saved, 'That doc does not exist.');

    return { doc, actions: [docAction(doc, syncId, actor, archived ? 'archive' : 'update')] };
  });
}

export interface SharedDoc extends SavedDoc {
  readonly publishToken: string | null;
}

export async function shareDoc(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SharedDoc> {
  assertCan(principal, 'doc:publish');
  const { visibility, rotateToken } = docShareSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadDoc(tx, principal, docId);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');

    const publishToken = tokenFor(visibility, rotateToken ? null : current.publishToken);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        visibility,
        publishToken,
        ...(current.slug.length === 0 ? { slug: docSlug(current.title) } : {}),
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning();
    const doc = requireRow(saved, 'That doc does not exist.');

    return { doc, publishToken, actions: [docAction(doc, syncId, actor, 'update')] };
  });
}

export async function createDocCollection(
  principal: Principal,
  input: unknown,
): Promise<SavedDocCollection> {
  assertCan(principal, 'doc:write');
  const parsed = docCollectionCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.docCollection)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        name: parsed.name,
        icon: parsed.icon,
        syncId,
      })
      .returning();
    const collection = requireRow(created, 'The collection could not be created.');

    return { collection, actions: [collectionAction(collection, syncId, actor, 'insert')] };
  });
}

function collectionAction(
  row: DocCollectionRow,
  syncId: number,
  actor: Awaited<ReturnType<typeof principalActor>>,
  action: 'insert' | 'update' | 'delete',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: [scopes.organization(row.organizationId)],
    action,
    model: 'doc_collection',
    modelId: row.id,
    data: row,
    actor,
  });
}

export async function updateDocCollection(
  principal: Principal,
  collectionId: string,
  input: unknown,
): Promise<SavedDocCollection> {
  assertCan(principal, 'doc:write');
  const parsed = docCollectionUpdateSchema.parse(input);
  if (Object.keys(parsed).length === 0) throw validationFailed('Nothing to change.');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.docCollection)
      .set({ ...parsed, syncId })
      .where(
        and(
          eq(schema.docCollection.id, collectionId),
          eq(schema.docCollection.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const collection = requireRow(saved, 'That collection does not exist.');

    return { collection, actions: [collectionAction(collection, syncId, actor, 'update')] };
  });
}

export async function deleteDocCollection(
  principal: Principal,
  collectionId: string,
): Promise<SyncAction[]> {
  assertCan(principal, 'doc:write');

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [removed] = await tx
      .delete(schema.docCollection)
      .where(
        and(
          eq(schema.docCollection.id, collectionId),
          eq(schema.docCollection.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const collection = requireRow(removed, 'That collection does not exist.');

    return [collectionAction(collection, syncId, actor, 'delete')];
  });
}
