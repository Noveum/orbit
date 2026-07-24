import { and, asc, db, eq, isNull, schema, sql } from '@orbit/db';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import {
  commentCreateSchema,
  commentUpdateSchema,
  paginationSchema,
} from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type DocCommentRow = typeof schema.docComment.$inferSelect;

interface DocRef {
  readonly id: string;
  readonly organizationId: string;
}

async function loadDocForComment(
  executor: Executor,
  principal: Principal,
  docId: string,
): Promise<DocRef> {
  const [row] = await executor
    .select({ id: schema.doc.id, organizationId: schema.doc.organizationId })
    .from(schema.doc)
    .where(and(eq(schema.doc.id, docId), eq(schema.doc.organizationId, principal.organizationId)))
    .limit(1);
  return requireRow(row, 'That doc does not exist.');
}

function docCommentScopes(doc: DocRef): string[] {
  return [scopes.organization(doc.organizationId), scopes.doc(doc.id)];
}

async function loadDocComment(
  executor: Executor,
  principal: Principal,
  commentId: string,
): Promise<DocCommentRow> {
  const [row] = await executor
    .select()
    .from(schema.docComment)
    .where(
      and(
        eq(schema.docComment.id, commentId),
        eq(schema.docComment.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  return requireRow(row, 'That comment does not exist.');
}

export interface DocCommentPage {
  readonly comments: DocCommentRow[];
  readonly nextCursor: string | null;
}

export async function listDocComments(
  principal: Principal,
  docId: string,
  input: unknown = {},
): Promise<DocCommentPage> {
  assertCan(principal, 'doc:read');
  await loadDocForComment(db, principal, docId);
  const page = paginationSchema.parse(input);

  const filters = [
    eq(schema.docComment.docId, docId),
    isNull(schema.docComment.deletedAt),
    sql`not exists (select 1 from doc_comment parent where parent.id = ${schema.docComment.parentId} and parent.deleted_at is not null)`,
  ];
  if (page.cursor !== undefined) {
    const [anchor] = await db
      .select({ id: schema.docComment.id })
      .from(schema.docComment)
      .where(and(eq(schema.docComment.id, page.cursor), eq(schema.docComment.docId, docId)))
      .limit(1);
    if (anchor === undefined) throw validationFailed('That page cursor is no longer valid.');
    filters.push(
      sql`(${schema.docComment.createdAt}, ${schema.docComment.id}) > (select ${schema.docComment.createdAt}, ${schema.docComment.id} from ${schema.docComment} where ${schema.docComment.id} = ${page.cursor})`,
    );
  }

  const rows = await db
    .select()
    .from(schema.docComment)
    .where(and(...filters))
    .orderBy(asc(schema.docComment.createdAt), asc(schema.docComment.id))
    .limit(page.limit + 1);

  const comments = rows.slice(0, page.limit);
  const nextCursor = rows.length > page.limit ? (comments.at(-1)?.id ?? null) : null;
  return { comments, nextCursor };
}

function docCommentAction(
  row: DocCommentRow,
  doc: DocRef,
  syncId: number,
  actor: Awaited<ReturnType<typeof principalActor>>,
  action: 'insert' | 'update' | 'delete',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: docCommentScopes(doc),
    action,
    model: 'doc_comment',
    modelId: row.id,
    data: row,
    actor,
  });
}

export interface SavedDocComment {
  readonly comment: DocCommentRow;
  readonly actions: SyncAction[];
}

export async function createDocComment(
  principal: Principal,
  docId: string,
  input: unknown,
): Promise<SavedDocComment> {
  assertCan(principal, 'comment:create');
  const parsed = commentCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const doc = await loadDocForComment(tx, principal, docId);

    if (parsed.parentId !== null) {
      const parent = await loadDocComment(tx, principal, parsed.parentId);
      if (parent.docId !== docId) {
        throw validationFailed('That reply belongs to another doc.');
      }
      if (parent.parentId !== null) {
        throw validationFailed('Replies only nest one level deep.');
      }
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.docComment)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        docId,
        authorId: principal.userId,
        parentId: parsed.parentId,
        body: parsed.body,
        syncId,
      })
      .returning();
    const comment = requireRow(created, 'The comment could not be created.');

    await tx
      .insert(schema.docSubscription)
      .values({ id: newId(), docId, userId: principal.userId })
      .onConflictDoNothing();

    return { comment, actions: [docCommentAction(comment, doc, syncId, actor, 'insert')] };
  });
}

export async function updateDocComment(
  principal: Principal,
  commentId: string,
  input: unknown,
): Promise<SavedDocComment> {
  assertCan(principal, 'comment:update:own');
  const parsed = commentUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadDocComment(tx, principal, commentId);
    if (current.authorId !== principal.userId) {
      throw forbidden('You can only edit your own comments.');
    }
    const doc = await loadDocForComment(tx, principal, current.docId);

    const now = new Date();
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.docComment)
      .set({ body: parsed.body, editedAt: now, updatedAt: now, syncId })
      .where(eq(schema.docComment.id, commentId))
      .returning();
    const comment = requireRow(updated, 'That comment does not exist.');

    return { comment, actions: [docCommentAction(comment, doc, syncId, actor, 'update')] };
  });
}

export async function deleteDocComment(
  principal: Principal,
  commentId: string,
): Promise<SyncAction[]> {
  return await db.transaction(async (tx) => {
    const current = await loadDocComment(tx, principal, commentId);
    const owned = current.authorId === principal.userId;
    if (owned) assertCan(principal, 'comment:update:own');
    else assertCan(principal, 'comment:delete:any');

    const doc = await loadDocForComment(tx, principal, current.docId);
    const now = new Date();
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [deleted] = await tx
      .update(schema.docComment)
      .set({ deletedAt: now, updatedAt: now, syncId })
      .where(eq(schema.docComment.id, commentId))
      .returning();
    const comment = requireRow(deleted, 'That comment does not exist.');

    return [docCommentAction(comment, doc, syncId, actor, 'delete')];
  });
}
