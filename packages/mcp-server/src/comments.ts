import {
  appendActivity,
  buildSyncAction,
  type IssueRow,
  issueScopes,
  newId,
  nextSyncId,
  principalActor,
} from '@orbit/core';
import { db, schema } from '@orbit/db';
import { internal } from '@orbit/shared/errors';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import { commentCreateSchema } from '@orbit/shared/validators';

export type CommentRow = typeof schema.comment.$inferSelect;

export interface CreatedComment {
  readonly comment: CommentRow;
  readonly actions: SyncAction[];
}

export async function createComment(
  principal: Principal,
  issue: IssueRow,
  input: unknown,
): Promise<CreatedComment> {
  assertCan(principal, 'comment:create');
  const parsed = commentCreateSchema.parse(input);

  return await db.transaction(async (tx) => {
    const syncId = await nextSyncId(tx);
    const actor = await principalActor(tx, principal);
    const [created] = await tx
      .insert(schema.comment)
      .values({
        id: newId(),
        organizationId: principal.organizationId,
        issueId: issue.id,
        authorId: principal.userId,
        parentId: parsed.parentId,
        body: parsed.body,
        syncId,
      })
      .returning();
    if (created === undefined) throw internal('The comment could not be created.');

    await appendActivity(tx, {
      organizationId: principal.organizationId,
      issueId: issue.id,
      actor,
      field: 'comment',
      from: null,
      to: created.id,
      syncId,
    });

    return {
      comment: created,
      actions: [
        buildSyncAction({
          syncId,
          organizationId: principal.organizationId,
          scopes: issueScopes(issue),
          action: 'insert',
          model: 'comment',
          modelId: created.id,
          data: created,
          actor,
        }),
      ],
    };
  });
}
