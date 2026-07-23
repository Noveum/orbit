import { and, asc, count, db, desc, eq, ilike, isNull, or, schema } from '@orbit/db';
import { conflict, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import {
  docCollectionCreateSchema,
  docCollectionUpdateSchema,
  docCreateSchema,
  docFilterSchema,
  docShareSchema,
  docUpdateSchema,
} from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, newToken, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type DocRow = typeof schema.doc.$inferSelect;
export type DocCollectionRow = typeof schema.docCollection.$inferSelect;
export type AttachmentRow = typeof schema.attachment.$inferSelect;

export interface DocAuthor {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface DocDetail {
  readonly doc: DocRow;
  readonly attachments: AttachmentRow[];
  readonly author: DocAuthor;
  readonly followers: number;
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

async function assertPlacement(
  executor: Executor,
  principal: Principal,
  placement: { collectionId?: string | null | undefined; projectId?: string | null | undefined },
): Promise<void> {
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

export async function listDocs(principal: Principal, input: unknown = {}): Promise<DocRow[]> {
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
    .select()
    .from(schema.doc)
    .where(and(...conditions))
    .orderBy(desc(schema.doc.updatedAt))
    .limit(500);
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
  };
}

export async function getDoc(principal: Principal, docId: string): Promise<DocDetail> {
  assertCan(principal, 'doc:read');
  return await detailFor(await loadDoc(db, principal, docId));
}

export async function getPublishedDoc(token: string): Promise<DocDetail | null> {
  if (token.trim().length === 0) return null;
  const [doc] = await db
    .select()
    .from(schema.doc)
    .where(and(eq(schema.doc.publishToken, token), isNull(schema.doc.archivedAt)))
    .limit(1);
  if (doc === undefined) return null;
  if (doc.visibility === 'workspace') return null;
  return await detailFor(doc);
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
        title: parsed.title,
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

    return { doc, actions: [docAction(doc, syncId, actor, 'insert')] };
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
    await assertPlacement(tx, principal, parsed);

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({
        ...parsed,
        ...(parsed.visibility === undefined
          ? {}
          : { publishToken: tokenFor(parsed.visibility, current.publishToken) }),
        updatedAt: new Date(),
        syncId,
      })
      .where(eq(schema.doc.id, docId))
      .returning();
    const doc = requireRow(saved, 'That doc does not exist.');

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
  const { visibility } = docShareSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadDoc(tx, principal, docId);
    if (current.archivedAt !== null) throw conflict('That doc is archived.');

    const publishToken = tokenFor(visibility, current.publishToken);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [saved] = await tx
      .update(schema.doc)
      .set({ visibility, publishToken, updatedAt: new Date(), syncId })
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
    model: 'doc',
    modelId: row.id,
    data: { ...row, kind: 'collection' },
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
      .set(parsed)
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
