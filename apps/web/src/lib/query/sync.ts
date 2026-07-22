import type { SyncAction } from '@orbit/shared/events';
import { z } from 'zod';
import type { Comment, Issue, Reaction } from './schemas.ts';
import { issueSchema, reactionSchema } from './schemas.ts';

const partialIssueSchema = issueSchema.partial().extend({
  id: z.string(),
  teamId: z.string().optional(),
  syncId: z.number().optional(),
});

const commentDeltaSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  authorId: z.string(),
  parentId: z.string().nullable().default(null),
  body: z.string(),
  editedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().default(null),
  syncId: z.number(),
});

const reactionDeltaSchema = reactionSchema.extend({ issueId: z.string().nullable().optional() });

export function isSelfEcho(action: SyncAction, currentUserId: string | null): boolean {
  return (
    currentUserId !== null && action.actor.type === 'user' && action.actor.id === currentUserId
  );
}

function isStale(incomingSyncId: number | undefined, existingSyncId: number): boolean {
  return incomingSyncId !== undefined && incomingSyncId <= existingSyncId;
}

type IssueDelta = Partial<Issue> & { id: string };

function definedFields(value: Record<string, unknown>): IssueDelta {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as IssueDelta;
}

export function applyIssueDelta(
  issues: readonly Issue[],
  action: SyncAction,
  teamId: string,
): readonly Issue[] {
  const parsed = partialIssueSchema.safeParse(action.data);
  if (!parsed.success) return issues;
  const incoming = parsed.data;
  const index = issues.findIndex((issue) => issue.id === incoming.id);

  if (action.action === 'delete' || action.action === 'archive') {
    return index === -1 ? issues : issues.filter((issue) => issue.id !== incoming.id);
  }

  if (index === -1) {
    const full = issueSchema.safeParse(action.data);
    if (!full.success) return issues;
    if (full.data.teamId !== teamId) return issues;
    if (full.data.archivedAt !== null) return issues;
    return [...issues, full.data];
  }

  const existing = issues[index];
  if (existing === undefined) return issues;
  if (isStale(incoming.syncId, existing.syncId)) return issues;

  const merged: Issue = {
    ...existing,
    ...definedFields(incoming),
    labelIds: existing.labelIds,
  };
  if (merged.teamId !== teamId) return issues.filter((issue) => issue.id !== incoming.id);

  const next = [...issues];
  next[index] = merged;
  return next;
}

export function applyIssueDetailDelta<T extends { issue: Issue; descriptionHtml?: string }>(
  detail: T | undefined,
  action: SyncAction,
): T | undefined {
  if (detail === undefined) return detail;
  const parsed = partialIssueSchema.safeParse(action.data);
  if (!parsed.success || parsed.data.id !== detail.issue.id) return detail;
  if (isStale(parsed.data.syncId, detail.issue.syncId)) return detail;

  const issue: Issue = {
    ...detail.issue,
    ...definedFields(parsed.data),
    labelIds: detail.issue.labelIds,
  };
  const descriptionChanged = issue.description !== detail.issue.description;
  return {
    ...detail,
    issue,
    ...(descriptionChanged ? { descriptionHtml: '' } : {}),
  };
}

export function applyCommentDelta(
  comments: readonly Comment[],
  action: SyncAction,
): readonly Comment[] {
  const parsed = commentDeltaSchema.safeParse(action.data);
  if (!parsed.success) return comments;
  const incoming = parsed.data;
  const index = comments.findIndex((entry) => entry.comment.id === incoming.id);

  if (action.action === 'delete' || incoming.deletedAt !== null) {
    return index === -1 ? comments : comments.filter((entry) => entry.comment.id !== incoming.id);
  }

  if (index === -1) {
    return [...comments, { comment: incoming, bodyHtml: '', reactions: [] }];
  }

  const existing = comments[index];
  if (existing === undefined) return comments;
  if (isStale(incoming.syncId, existing.comment.syncId)) return comments;

  const next = [...comments];
  next[index] = { ...existing, comment: incoming, bodyHtml: '' };
  return next;
}

export function applyReactionDelta(
  comments: readonly Comment[],
  action: SyncAction,
): readonly Comment[] {
  const parsed = reactionDeltaSchema.safeParse(action.data);
  if (!parsed.success) return comments;
  const incoming: Reaction = {
    id: parsed.data.id,
    commentId: parsed.data.commentId,
    userId: parsed.data.userId,
    emoji: parsed.data.emoji,
  };
  if (incoming.commentId === null) return comments;

  return comments.map((entry) => {
    if (entry.comment.id !== incoming.commentId) return entry;
    const without = entry.reactions.filter((reaction) => reaction.id !== incoming.id);
    if (action.action === 'delete') return { ...entry, reactions: without };
    return { ...entry, reactions: [...without, incoming] };
  });
}

export interface ReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

export function summarizeReactions(
  reactions: readonly Reaction[],
  currentUserId: string | null,
): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const reaction of reactions) {
    const current = byEmoji.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    byEmoji.set(reaction.emoji, {
      emoji: reaction.emoji,
      count: current.count + 1,
      mine: current.mine || reaction.userId === currentUserId,
    });
  }
  return [...byEmoji.values()].sort((left, right) => left.emoji.localeCompare(right.emoji));
}

export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.identifier.localeCompare(right.identifier);
  });
}
