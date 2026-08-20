import type { SyncAction } from '@orbit/shared/events';
import type { IssueOrdering } from '@orbit/shared/filters';
import { docCommentAnchorSchema } from '@orbit/shared/validators';
import type { InfiniteData } from '@tanstack/react-query';
import { z } from 'zod';
import type { Comment, DocComment, Issue, IssuePage, Reaction } from './schemas.ts';
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

const docCommentDeltaSchema = z.object({
  id: z.string(),
  docId: z.string(),
  authorId: z.string(),
  parentId: z.string().nullable().default(null),
  body: z.string(),
  anchor: docCommentAnchorSchema.nullable().default(null),
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

function reviewerDelta(
  data: Record<string, unknown>,
  incoming: { readonly reviewerIds?: string[] | undefined },
) {
  if (data['reviewerIds'] === undefined || incoming.reviewerIds === undefined) return {};
  return { reviewerIds: incoming.reviewerIds };
}

export type IssueBelongs = (issue: Issue) => boolean;

export function participatesIn(issue: Issue, userId: string): boolean {
  return issue.assigneeId === userId || (issue.reviewerIds ?? []).includes(userId);
}

const SCOPED_PARAMS = ['teamId', 'stateId', 'assigneeId', 'projectId', 'cycleId'] as const;

const ISSUE_FIELD_OF: Record<(typeof SCOPED_PARAMS)[number], keyof Issue> = {
  teamId: 'teamId',
  stateId: 'stateId',
  assigneeId: 'assigneeId',
  projectId: 'projectId',
  cycleId: 'cycleId',
};

export function belongsInList(search: string, issue: Issue): boolean {
  const params = new URLSearchParams(search);
  const scoped = SCOPED_PARAMS.every((name) => {
    const expected = params.get(name);
    return expected === null || issue[ISSUE_FIELD_OF[name]] === expected;
  });
  if (!scoped) return false;
  const participantId = params.get('participantId');
  if (participantId === null) return true;
  if (participantId === 'none') return issue.assigneeId === null;
  return participatesIn(issue, participantId);
}

const GROUPED_PARAMS = ['stateId', 'assigneeId', 'projectId', 'cycleId'] as const;

export function isGroupColumn(search: string, issue: Issue): boolean {
  const params = new URLSearchParams(search);
  return GROUPED_PARAMS.some((name) => {
    const expected = params.get(name);
    return expected !== null && issue[ISSUE_FIELD_OF[name]] === expected;
  });
}

export function searchOf(key: readonly unknown[]): string {
  if (key.length < 3) return '';
  const last = key.at(-1);
  return typeof last === 'string' ? last : '';
}

export function admitsNewRows(search: string): boolean {
  return (new URLSearchParams(search).get('filter') ?? '') === '';
}

export function awaitsServerRefresh(
  issues: readonly Issue[],
  action: SyncAction,
  belongs: IssueBelongs,
  search: string,
): boolean {
  if (action.action === 'delete' || action.action === 'archive') return false;
  if (admitsNewRows(search)) return false;
  const full = issueSchema.safeParse(action.data);
  if (!full.success || full.data.archivedAt !== null) return false;
  if (!belongs(full.data)) return false;
  return !issues.some((issue) => issue.id === full.data.id);
}

export function applyIssueDelta(
  issues: readonly Issue[],
  action: SyncAction,
  belongs: IssueBelongs,
  search = '',
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
    if (!admitsNewRows(search)) return issues;
    return sortForSearch(search, [...issues, full.data]);
  }

  const existing = issues[index];
  if (existing === undefined) return issues;
  if (isStale(incoming.syncId, existing.syncId)) return issues;

  const merged: Issue = {
    ...existing,
    ...definedFields(incoming),
    labelIds: existing.labelIds,
    ...reviewerDelta(action.data, incoming),
  };
  if (!belongs(merged)) return issues.filter((issue) => issue.id !== incoming.id);

  const next = [...issues];
  next[index] = merged;
  return sortForSearch(search, next);
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
  search = '',
): IssuePages | undefined {
  if (data === undefined) return data;
  return mapIssuePages(data, (issues) => applyIssueDelta(issues, action, belongs, search));
}

export function withoutIssues(
  issues: readonly Issue[],
  removed: ReadonlySet<string>,
): readonly Issue[] {
  let changed = false;
  const next = issues.flatMap((issue) => {
    if (removed.has(issue.id)) {
      changed = true;
      return [];
    }
    if (issue.parentId === null || !removed.has(issue.parentId)) return [issue];
    changed = true;
    return [{ ...issue, parentId: null }];
  });
  return changed ? next : issues;
}

export function withoutSubIssue<T extends { issue: Issue; subIssues: readonly Issue[] }>(
  detail: T | undefined,
  removedId: string,
): T | undefined {
  if (detail === undefined) return detail;
  const subIssues = detail.subIssues.filter((child) => child.id !== removedId);
  return subIssues.length === detail.subIssues.length ? detail : { ...detail, subIssues };
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
    ...reviewerDelta(action.data, parsed.data),
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

export function applyDocCommentDelta(
  comments: readonly DocComment[],
  action: SyncAction,
): readonly DocComment[] {
  const parsed = docCommentDeltaSchema.safeParse(action.data);
  if (!parsed.success) return comments;
  const incoming = parsed.data;
  const index = comments.findIndex((entry) => entry.comment.id === incoming.id);

  if (action.action === 'delete' || incoming.deletedAt !== null) {
    return index === -1 ? comments : comments.filter((entry) => entry.comment.id !== incoming.id);
  }

  if (index === -1) {
    return [...comments, { comment: incoming, bodyHtml: '' }];
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

const ORDER_READERS: Record<
  IssueOrdering,
  { readonly descending: boolean; readonly read: (issue: Issue) => string | number }
> = {
  manual: { descending: false, read: (issue) => issue.sortOrder },
  priority: { descending: false, read: (issue) => (issue.priority === 0 ? 5 : issue.priority) },
  created: { descending: true, read: (issue) => issue.createdAt },
  updated: { descending: true, read: (issue) => issue.updatedAt },
  due: { descending: false, read: (issue) => issue.dueDate ?? '9999-12-31' },
  estimate: { descending: false, read: (issue) => issue.estimate ?? 9999 },
  title: { descending: false, read: (issue) => issue.title.toLowerCase() },
};

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

export function orderingOf(search: string): IssueOrdering {
  const requested = new URLSearchParams(search).get('orderBy');
  return requested !== null && Object.hasOwn(ORDER_READERS, requested)
    ? (requested as IssueOrdering)
    : 'manual';
}

export function sortForSearch(search: string, issues: readonly Issue[]): Issue[] {
  const ordering = ORDER_READERS[orderingOf(search)];
  const sign = ordering.descending ? -1 : 1;
  return [...issues].sort((left, right) => {
    const primary = compareValues(ordering.read(left), ordering.read(right));
    if (primary !== 0) return primary * sign;
    return left.id.localeCompare(right.id) * sign;
  });
}
