import { and, asc, db, eq, inArray, isNull, schema } from '@orbit/db';
import { forbidden, notFound, validationFailed } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan, assertInTeam } from '@orbit/shared/policy';
import { commentCreateSchema, commentUpdateSchema, reactionSchema } from '@orbit/shared/validators';
import { principalActor } from '../activity/activity-service.ts';
import { type Executor, newId, requireRow } from '../internal.ts';
import { buildSyncAction } from '../realtime/publisher.ts';
import { nextSyncId } from '../sync/sync-id.ts';

export type CommentRow = typeof schema.comment.$inferSelect;
export type ReactionRow = typeof schema.reaction.$inferSelect;

export interface CommentWithReactions {
  readonly comment: CommentRow;
  readonly reactions: ReactionRow[];
}

async function loadIssueForComment(executor: Executor, principal: Principal, issueId: string) {
  const [row] = await executor
    .select({
      id: schema.issue.id,
      teamId: schema.issue.teamId,
      projectId: schema.issue.projectId,
      organizationId: schema.issue.organizationId,
      identifier: schema.issue.identifier,
    })
    .from(schema.issue)
    .where(
      and(eq(schema.issue.id, issueId), eq(schema.issue.organizationId, principal.organizationId)),
    )
    .limit(1);
  const issue = requireRow(row, 'That issue does not exist.');
  assertInTeam(principal, issue.teamId);
  return issue;
}

function commentScopes(issue: { organizationId: string; teamId: string; id: string }): string[] {
  return [
    scopes.organization(issue.organizationId),
    scopes.team(issue.teamId),
    scopes.issue(issue.id),
  ];
}

async function loadComment(
  executor: Executor,
  principal: Principal,
  commentId: string,
): Promise<CommentRow> {
  const [row] = await executor
    .select()
    .from(schema.comment)
    .where(
      and(
        eq(schema.comment.id, commentId),
        eq(schema.comment.organizationId, principal.organizationId),
      ),
    )
    .limit(1);
  return requireRow(row, 'That comment does not exist.');
}

export async function listComments(
  principal: Principal,
  issueId: string,
): Promise<CommentWithReactions[]> {
  assertCan(principal, 'issue:read');
  await loadIssueForComment(db, principal, issueId);

  const comments = await db
    .select()
    .from(schema.comment)
    .where(and(eq(schema.comment.issueId, issueId), isNull(schema.comment.deletedAt)))
    .orderBy(asc(schema.comment.createdAt));

  if (comments.length === 0) return [];

  const reactions = await db
    .select()
    .from(schema.reaction)
    .where(
      inArray(
        schema.reaction.commentId,
        comments.map((row) => row.id),
      ),
    );

  const byComment = new Map<string, ReactionRow[]>();
  for (const row of reactions) {
    if (row.commentId === null) continue;
    const bucket = byComment.get(row.commentId) ?? [];
    bucket.push(row);
    byComment.set(row.commentId, bucket);
  }

  return comments.map((comment) => ({
    comment,
    reactions: byComment.get(comment.id) ?? [],
  }));
}

function commentAction(
  row: CommentRow,
  issue: { organizationId: string; teamId: string; id: string },
  syncId: number,
  actor: Awaited<ReturnType<typeof principalActor>>,
  action: 'insert' | 'update' | 'delete',
): SyncAction {
  return buildSyncAction({
    syncId,
    organizationId: row.organizationId,
    scopes: commentScopes(issue),
    action,
    model: 'comment',
    modelId: row.id,
    data: row,
    actor,
  });
}

export interface CreatedComment {
  readonly comment: CommentRow;
  readonly actions: SyncAction[];
}

export async function createComment(
  principal: Principal,
  issueId: string,
  input: unknown,
): Promise<CreatedComment> {
  assertCan(principal, 'comment:create');
  const parsed = commentCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const issue = await loadIssueForComment(tx, principal, issueId);

    if (parsed.parentId !== null) {
      const parent = await loadComment(tx, principal, parsed.parentId);
      if (parent.issueId !== issueId) {
        throw validationFailed('That reply belongs to another issue.');
      }
      if (parent.parentId !== null) {
        throw validationFailed('Replies only nest one level deep.');
      }
    }

    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.comment)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        issueId,
        authorId: principal.userId,
        parentId: parsed.parentId,
        body: parsed.body,
        syncId,
      })
      .returning();
    const comment = requireRow(created, 'The comment could not be created.');

    await tx
      .insert(schema.issueSubscription)
      .values({ id: newId(), issueId, userId: principal.userId })
      .onConflictDoNothing();

    return { comment, actions: [commentAction(comment, issue, syncId, actor, 'insert')] };
  });
}

export async function updateComment(
  principal: Principal,
  commentId: string,
  input: unknown,
): Promise<CreatedComment> {
  assertCan(principal, 'comment:update:own');
  const parsed = commentUpdateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadComment(tx, principal, commentId);
    if (current.authorId !== principal.userId) {
      throw forbidden('You can only edit your own comments.');
    }
    const issue = await loadIssueForComment(tx, principal, current.issueId);

    const now = new Date();
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [updated] = await tx
      .update(schema.comment)
      .set({ body: parsed.body, editedAt: now, updatedAt: now, syncId })
      .where(eq(schema.comment.id, commentId))
      .returning();
    const comment = requireRow(updated, 'That comment does not exist.');

    return { comment, actions: [commentAction(comment, issue, syncId, actor, 'update')] };
  });
}

export async function deleteComment(
  principal: Principal,
  commentId: string,
): Promise<SyncAction[]> {
  return await db.transaction(async (tx) => {
    const current = await loadComment(tx, principal, commentId);
    const owned = current.authorId === principal.userId;
    if (owned) assertCan(principal, 'comment:update:own');
    else assertCan(principal, 'comment:delete:any');

    const issue = await loadIssueForComment(tx, principal, current.issueId);
    const now = new Date();
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [deleted] = await tx
      .update(schema.comment)
      .set({ deletedAt: now, updatedAt: now, syncId })
      .where(eq(schema.comment.id, commentId))
      .returning();
    const comment = requireRow(deleted, 'That comment does not exist.');

    return [commentAction(comment, issue, syncId, actor, 'delete')];
  });
}

export interface ToggledReaction {
  readonly emoji: string;
  readonly active: boolean;
  readonly actions: SyncAction[];
}

export async function toggleReaction(
  principal: Principal,
  commentId: string,
  input: unknown,
): Promise<ToggledReaction> {
  assertCan(principal, 'reaction:toggle');
  const parsed = reactionSchema.parse(input);

  return await db.transaction(async (tx) => {
    const current = await loadComment(tx, principal, commentId);
    const issue = await loadIssueForComment(tx, principal, current.issueId);
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);

    const removed = await tx
      .delete(schema.reaction)
      .where(
        and(
          eq(schema.reaction.commentId, commentId),
          eq(schema.reaction.userId, principal.userId),
          eq(schema.reaction.emoji, parsed.emoji),
        ),
      )
      .returning();

    if (removed.length > 0) {
      const row = removed[0];
      if (row === undefined) throw notFound('That reaction does not exist.');
      return {
        emoji: parsed.emoji,
        active: false,
        actions: [
          buildSyncAction({
            syncId,
            organizationId: principal.organizationId,
            scopes: commentScopes(issue),
            action: 'delete',
            model: 'reaction',
            modelId: row.id,
            data: { ...row, commentId },
            actor,
          }),
        ],
      };
    }

    const [created] = await tx
      .insert(schema.reaction)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        commentId,
        issueId: current.issueId,
        userId: principal.userId,
        emoji: parsed.emoji,
        syncId,
      })
      .returning();
    const reaction = requireRow(created, 'The reaction could not be saved.');

    return {
      emoji: parsed.emoji,
      active: true,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: commentScopes(issue),
          action: 'insert',
          model: 'reaction',
          modelId: reaction.id,
          data: reaction,
          actor,
        }),
      ],
    };
  });
}
