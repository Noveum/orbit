import type { SyncAction } from '@orbit/shared/events';
import type { InfiniteData } from '@tanstack/react-query';
import { z } from 'zod';
import type { Comment, Issue, IssuePage, Reaction } from './schemas.ts';
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

function isStale(incomingSyncId: number | undefined, existingSyncId: number): boolean {
  return incomingSyncId !== undefined && incomingSyncId <= existingSyncId;
}

type IssueDelta = Partial<Issue> & { id: string };

function definedFields(value: Record<string, unknown>): IssueDelta {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries) as IssueDelta;
}

export type IssueBelongs = (issue: Issue) => boolean;

export function applyIssueDelta(
  issues: readonly Issue[],
  action: SyncAction,
  belongs: IssueBelongs,
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
    if (!belongs(full.data)) return issues;
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
  if (!belongs(merged)) return issues.filter((issue) => issue.id !== incoming.id);

  const next = [...issues];
  next[index] = merged;
  return next;
}

export type IssuePages = InfiniteData<IssuePage, string | null>;

export function flattenIssuePages(data: IssuePages): readonly Issue[] {
  if (data.pages.length === 1) return data.pages[0]?.issues ?? [];
  return data.pages.flatMap((page) => page.issues);
}

export function mapIssuePages(
  data: IssuePages,
  update: (issues: readonly Issue[]) => readonly Issue[],
): IssuePages {
  const flat = flattenIssuePages(data);
  const next = update(flat);
  if (next === flat) return data;

  let taken = 0;
  const pages = data.pages.map((page, index) => {
    const last = index === data.pages.length - 1;
    const size = last ? next.length - taken : Math.min(page.issues.length, next.length - taken);
    const issues = next.slice(taken, taken + Math.max(0, size));
    taken += issues.length;
    return { ...page, issues };
  });
  return { ...data, pages };
}

export function applyIssueDeltaToPages(
  data: IssuePages | undefined,
  action: SyncAction,
  belongs: IssueBelongs,
): IssuePages | undefined {
  if (data === undefined) return data;
  return mapIssuePages(data, (issues) => applyIssueDelta(issues, action, belongs));
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
