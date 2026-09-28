import type {
  InboxConversation,
  InboxConversationPage,
  InboxCounterSnapshot,
  InboxTab,
} from '@orbit/shared/validators';
import type { InfiniteData } from '@tanstack/react-query';

export function conversationMatchesTab(
  row: InboxConversation,
  tab: InboxTab,
  now = Date.now(),
): boolean {
  if (row.dismissedAt !== null || (row.snoozedUntil !== null && Date.parse(row.snoozedUntil) > now))
    return false;
  if (tab === 'unread') return !row.read;
  if (tab === 'mentions') return row.hasMention;
  if (tab === 'pulls') return row.subjectType === 'github_pull_request';
  return row.category === tab;
}

export function newestCounterSnapshot(
  current: InboxCounterSnapshot,
  incoming: InboxCounterSnapshot,
): InboxCounterSnapshot {
  return incoming.counterVersion >= current.counterVersion ? incoming : current;
}

export function currentConversationRows(
  pages: readonly InboxConversationPage[],
  versions: ReadonlyMap<string, number>,
): InboxConversation[] {
  const rows = new Map<string, InboxConversation>();
  for (const page of pages)
    for (const row of page.conversations) {
      if (row.syncId < (versions.get(row.id) ?? 0)) continue;
      const previous = rows.get(row.id);
      if (previous === undefined || previous.syncId <= row.syncId) rows.set(row.id, row);
    }
  return [...rows.values()].sort(
    (a, b) => b.lastActivitySeq - a.lastActivitySeq || b.id.localeCompare(a.id),
  );
}

export function upsertConversationPages(
  current: InfiniteData<InboxConversationPage, string | null> | undefined,
  changes: readonly InboxConversation[],
  removedIds: ReadonlySet<string>,
  tab: InboxTab,
  snapshot: InboxCounterSnapshot,
): InfiniteData<InboxConversationPage, string | null> | undefined {
  if (current === undefined) return undefined;
  const existing = new Map(
    current.pages.flatMap((page) => page.conversations.map((row) => [row.id, row] as const)),
  );
  for (const row of changes) {
    const previous = existing.get(row.id);
    if (previous === undefined || previous.syncId <= row.syncId) existing.set(row.id, row);
  }
  for (const id of removedIds) existing.delete(id);
  const rows = [...existing.values()]
    .filter((row) => conversationMatchesTab(row, tab))
    .sort((a, b) => b.lastActivitySeq - a.lastActivitySeq || b.id.localeCompare(a.id));
  return {
    ...current,
    pages: current.pages.map((page, index) => ({
      ...page,
      ...newestCounterSnapshot(page, snapshot),
      conversations: index === 0 ? rows : [],
    })),
  };
}
