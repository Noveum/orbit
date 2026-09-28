import { describe, expect, it } from 'bun:test';
import type { InboxConversation, InboxConversationPage } from '@orbit/shared/validators';
import {
  conversationMatchesTab,
  currentConversationRows,
  newestCounterSnapshot,
  upsertConversationPages,
} from '../../../src/features/inbox/conversation-state.ts';

const counters = { unreadCount: 2, unreadActivityCount: 2, unreadMentionCount: 1 };
const row: InboxConversation = {
  id: 'conversation-1',
  conversationKey: 'github-pr:123:5',
  subjectType: 'github_pull_request',
  subjectId: 'pr-1',
  category: 'activity',
  latestEventId: 'event-1',
  type: 'pr_checks_failed',
  actorName: 'Developer',
  title: 'Checks failed',
  body: '',
  bodyHtml: '',
  url: '/pulls/pr-1',
  externalUrl: null,
  occurredAt: '2026-09-01T12:00:00.000Z',
  lastActivityAt: '2026-09-01T12:00:00.000Z',
  lastActivitySeq: 10,
  eventCount: 5,
  unreadEventCount: 2,
  unreadMentionCount: 1,
  hasMention: true,
  read: false,
  snoozedUntil: null,
  dismissedAt: null,
  syncId: 15,
};

function page(rows: InboxConversation[]): InboxConversationPage {
  return { conversations: rows, nextCursor: 'older', counters, counterVersion: 20 };
}

describe('conversation state', () => {
  it('does not resurrect a revoked conversation from an in-flight stale page', () => {
    expect(currentConversationRows([page([row])], new Map([[row.id, row.syncId + 1]]))).toEqual([]);
    expect(
      currentConversationRows([page([row]), page([row])], new Map([[row.id, row.syncId]])),
    ).toHaveLength(1);
  });
  it('keeps checks in the PR activity conversation rather than the Status tab', () => {
    expect(conversationMatchesTab(row, 'pulls')).toBe(true);
    expect(conversationMatchesTab(row, 'activity')).toBe(true);
    expect(conversationMatchesTab(row, 'status')).toBe(false);
  });
  it('matches mentions from history even when the latest event is a check', () => {
    expect(conversationMatchesTab(row, 'mentions')).toBe(true);
  });
  it('removes snoozed and dismissed conversations from every tab', () => {
    expect(
      conversationMatchesTab(
        { ...row, snoozedUntil: new Date(Date.now() + 10_000).toISOString() },
        'activity',
      ),
    ).toBe(false);
    expect(conversationMatchesTab({ ...row, dismissedAt: row.occurredAt }, 'pulls')).toBe(false);
  });
  it('does not replace authoritative counters with an older response', () => {
    const current = { counters, counterVersion: 100 };
    expect(
      newestCounterSnapshot(current, {
        counters: { ...counters, unreadCount: 7 },
        counterVersion: 90,
      }),
    ).toBe(current);
  });
  it('upserts unseen updates and reorders moved conversations without duplicates', () => {
    const other = { ...row, id: 'other', lastActivitySeq: 12 };
    const current = { pages: [page([other]), page([row])], pageParams: [null, 'older'] };
    const result = upsertConversationPages(
      current,
      [
        { ...row, syncId: 40, lastActivitySeq: 30 },
        { ...row, id: 'new', syncId: 41, lastActivitySeq: 31 },
      ],
      new Set(),
      'activity',
      { counters, counterVersion: 45 },
    );
    expect(result?.pages.flatMap((entry) => entry.conversations.map((item) => item.id))).toEqual([
      'new',
      row.id,
      'other',
    ]);
    expect(result?.pages.at(-1)?.nextCursor).toBe('older');
  });
  it('ignores stale row updates and removes access-revoked rows', () => {
    const current = { pages: [page([row])], pageParams: [null] };
    const stale = upsertConversationPages(
      current,
      [{ ...row, syncId: 5, title: 'Stale' }],
      new Set(),
      'activity',
      { counters, counterVersion: 10 },
    );
    expect(stale?.pages[0]?.conversations[0]?.title).toBe(row.title);
    expect(stale?.pages[0]?.counterVersion).toBe(20);
    const revoked = upsertConversationPages(current, [], new Set([row.id]), 'activity', {
      counters,
      counterVersion: 21,
    });
    expect(revoked?.pages[0]?.conversations).toHaveLength(0);
  });
});
