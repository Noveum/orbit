'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import type { NotificationType } from '@orbit/shared/constants';
import { isPullRequestNotification, NOTIFICATION_TYPES } from '@orbit/shared/constants';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { relativeTime } from '@orbit/shared/utils';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  AtSign,
  Bell,
  CheckCircle2,
  CircleDot,
  FileText,
  FolderKanban,
  GitMerge,
  GitPullRequest,
  Lock,
  MessageSquare,
  Smile,
  Unlock,
  UserPlus,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { DocSurface } from '@/features/docs/doc-surface.tsx';
import { IssueDetailView } from '@/features/issues/issue-detail.tsx';
import { apiRequest } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { clientId } from '@/lib/query/client-id.ts';
import type { InboxItem } from './data.ts';
import { docIdFromUrl, issueIdentifierFromUrl } from './inbox-links.ts';

const SOURCE_ICONS: Record<NotificationType, LucideIcon> = {
  issue_assigned: CircleDot,
  issue_unassigned: CircleDot,
  issue_status_changed: CircleDot,
  issue_priority_changed: CircleDot,
  comment_created: MessageSquare,
  comment_replied: MessageSquare,
  mention: AtSign,
  reaction: Smile,
  subscription_activity: Bell,
  document_changed: FileText,
  doc_access_requested: Lock,
  doc_access_granted: Unlock,
  project_update: FolderKanban,
  reminder_due: Bell,
  triage_added: CircleDot,
  invite_accepted: UserPlus,
  member_joined: UserPlus,
  pr_review_requested: GitPullRequest,
  pr_review_submitted: MessageSquare,
  pr_approved: CheckCircle2,
  pr_merged: GitMerge,
  pr_closed: XCircle,
  pr_checks_failed: AlertTriangle,
};

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'pulls', label: 'Pull requests' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function matchesTab(item: InboxItem, tab: TabId): boolean {
  if (tab === 'unread') return !item.read;
  if (tab === 'mentions') return item.type === 'mention';
  if (tab === 'pulls') return isPullRequestNotification(item.type);
  return true;
}

const SNOOZE_HOURS = 24;

const notificationDeltaSchema = z.object({
  id: z.string(),
  type: z.string(),
  entityType: z.string().default(''),
  entityId: z.string().default(''),
  actorName: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  readAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string(),
});

const unreadCountSchema = z.object({ unreadCount: z.number() });

function toNotificationType(value: string): NotificationType {
  return NOTIFICATION_TYPES.find((entry) => entry === value) ?? 'subscription_activity';
}

const inboxPageSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      entityType: z.string().default(''),
      entityId: z.string().default(''),
      actorName: z.string(),
      title: z.string(),
      body: z.string(),
      url: z.string(),
      read: z.boolean(),
      snoozedUntil: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

function toInboxItem(data: Record<string, unknown>): InboxItem | null {
  const parsed = notificationDeltaSchema.safeParse(data);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    id: row.id,
    type: toNotificationType(row.type),
    entityType: row.entityType,
    entityId: row.entityId,
    actorName: row.actorName,
    title: row.title,
    body: row.body,
    url: row.url,
    read: row.readAt !== null,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
  };
}

interface InboxPatch {
  readonly rows: readonly InboxItem[];
  readonly unreadDelta: number;
  readonly mentionDelta: number;
}

function readChange(read: boolean): number {
  return read ? -1 : 1;
}

function unreadMentionCount(item: InboxItem): number {
  return !item.read && item.type === 'mention' ? 1 : 0;
}

function applyOne(patch: InboxPatch, action: SyncAction): InboxPatch {
  const item = toInboxItem(action.data);
  if (item === null) return patch;
  const previous = patch.rows.find((row) => row.id === item.id);

  if (action.action === 'delete') {
    if (previous === undefined) return patch;
    return {
      rows: patch.rows.filter((row) => row.id !== item.id),
      unreadDelta: patch.unreadDelta - (previous.read ? 0 : 1),
      mentionDelta: patch.mentionDelta - unreadMentionCount(previous),
    };
  }
  if (previous === undefined) {
    if (action.action !== 'insert') return patch;
    return {
      rows: [item, ...patch.rows],
      unreadDelta: patch.unreadDelta + (item.read ? 0 : 1),
      mentionDelta: patch.mentionDelta + unreadMentionCount(item),
    };
  }
  const change = previous.read === item.read ? 0 : readChange(item.read);
  return {
    rows: patch.rows.map((row) => (row.id === item.id ? item : row)),
    unreadDelta: patch.unreadDelta + change,
    mentionDelta: patch.mentionDelta + (unreadMentionCount(item) - unreadMentionCount(previous)),
  };
}

export function applyNotificationDeltas(
  rows: readonly InboxItem[],
  actions: readonly SyncAction[],
  tabClientId: string,
): InboxPatch {
  return actions
    .filter((action) => action.model === 'notification' && action.originClientId !== tabClientId)
    .reduce(applyOne, { rows, unreadDelta: 0, mentionDelta: 0 });
}

function LoadMoreRow({
  loading,
  onReach,
}: {
  readonly loading: boolean;
  readonly onReach: () => void;
}) {
  const reach = useRef(onReach);
  reach.current = onReach;

  const watch = useCallback((node: HTMLButtonElement | null) => {
    if (node === null || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) reach.current();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={watch}
      type="button"
      onClick={onReach}
      disabled={loading}
      data-testid="inbox-load-more"
      className="w-full px-3 py-3 text-center text-2xs text-faint transition-colors duration-[var(--duration-fast)] hover:text-muted"
    >
      {loading ? 'Loading older notifications' : 'Load older notifications'}
    </button>
  );
}

function NotificationBody({
  item,
  canWriteDocs,
  canPublishDocs,
  onIssueDeleted,
}: {
  readonly item: InboxItem;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
  readonly onIssueDeleted: () => void;
}) {
  const identifier = issueIdentifierFromUrl(item.url);
  if (identifier !== null) {
    return (
      <div className="min-h-0 flex-1">
        <IssueDetailView
          key={item.id}
          identifier={identifier}
          focusCommentId={item.entityType === 'comment' ? item.entityId : null}
          onDeleted={onIssueDeleted}
        />
      </div>
    );
  }

  const docId = docIdFromUrl(item.url);
  if (docId !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DocSurface
          key={item.id}
          docId={docId}
          canWriteDocs={canWriteDocs}
          canPublish={canPublishDocs}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {item.body.length === 0 ? null : (
        <p className="whitespace-pre-wrap text-muted text-sm">{item.body}</p>
      )}
    </div>
  );
}

function NotificationDetail({
  item,
  onOpen,
  canWriteDocs,
  canPublishDocs,
  onIssueDeleted,
}: {
  readonly item: InboxItem;
  readonly onOpen: () => void;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
  readonly onIssueDeleted: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 border-border border-b px-5 py-2">
        <p className="min-w-0 flex-1 truncate text-2xs text-faint">
          <span className="text-muted">{item.title}</span> · {item.actorName} ·{' '}
          {relativeTime(new Date(item.createdAt))}
          {item.snoozedUntil === null ? '' : ' · snoozed'}
        </p>
        <Link
          href={item.url}
          data-testid="inbox-open-link"
          onClick={onOpen}
          className="shrink-0 rounded-sm text-accent text-2xs hover:underline"
        >
          Open in Orbit
        </Link>
      </div>

      {isPullRequestNotification(item.type) && item.body.length > 0 ? (
        <p
          className="border-border border-b px-5 py-1.5 text-2xs text-muted"
          data-testid="inbox-event-context"
        >
          {item.body}
        </p>
      ) : null}

      <NotificationBody
        item={item}
        canWriteDocs={canWriteDocs}
        canPublishDocs={canPublishDocs}
        onIssueDeleted={onIssueDeleted}
      />
    </>
  );
}

export interface InboxViewProps {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly unreadMentions: number;
  readonly nextCursor: string | null;
  readonly userId: string;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
}

export function InboxView({
  items,
  unreadCount,
  unreadMentions,
  nextCursor,
  userId,
  canWriteDocs,
  canPublishDocs,
}: InboxViewProps) {
  const [rows, setRows] = useState<readonly InboxItem[]>(items);
  const [unread, setUnread] = useState(unreadCount);
  const [mentions, setMentions] = useState(unreadMentions);
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pagingError, setPagingError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const cursorRef = useRef<string | null>(nextCursor);
  const [tab, setTab] = useState<TabId>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(items);
    setUnread(unreadCount);
    setMentions(unreadMentions);
    setCursor(nextCursor);
    cursorRef.current = nextCursor;
  }, [items, unreadCount, unreadMentions, nextCursor]);

  useScopeSubscription([scopes.user(userId)]);
  useDeltaHandler(
    useCallback(
      (actions) => {
        const patch = applyNotificationDeltas(rows, actions, clientId());
        if (patch.rows !== rows) setRows(patch.rows);
        if (patch.unreadDelta !== 0) {
          setUnread((current) => Math.max(0, current + patch.unreadDelta));
        }
        if (patch.mentionDelta !== 0) {
          setMentions((current) => Math.max(0, current + patch.mentionDelta));
        }
      },
      [rows],
    ),
  );

  const visible = useMemo(
    () => rows.filter((row) => matchesTab(row, tab) || row.id === selectedId),
    [rows, tab, selectedId],
  );
  const selectedIndex = visible.findIndex((row) => row.id === selectedId);
  const current = visible[selectedIndex === -1 ? 0 : selectedIndex];

  const loadMore = useCallback(async () => {
    const from = cursorRef.current;
    if (from === null || inFlight.current) return;
    inFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await apiRequest<unknown>(
        `/api/notifications?cursor=${encodeURIComponent(from)}`,
      );
      const parsed = inboxPageSchema.parse(page);
      const older = parsed.notifications.map((row) => ({
        ...row,
        type: toNotificationType(row.type),
      }));
      setRows((list) => {
        const known = new Set(list.map((row) => row.id));
        return [...list, ...older.filter((item) => !known.has(item.id))];
      });
      cursorRef.current = parsed.nextCursor;
      setCursor(parsed.nextCursor);
      setPagingError(null);
    } catch {
      setPagingError('Could not load these. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setLoadingMore(false);
    }
  }, []);

  const leaveDeletedIssue = useCallback(() => {
    if (current === undefined) return;
    const index = visible.findIndex((row) => row.id === current.id);
    const next = visible[index + 1] ?? visible[index - 1];
    setSelectedId(next?.id ?? null);
  }, [visible, current]);

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const from =
        selectedId === null
          ? 0
          : Math.max(
              0,
              visible.findIndex((row) => row.id === selectedId),
            );
      const next = Math.min(Math.max(0, from + delta), visible.length - 1);
      setSelectedId(visible[next]?.id ?? null);
    },
    [visible, selectedId],
  );

  const selectTab = useCallback((next: TabId) => {
    setTab(next);
    setSelectedId(null);
  }, []);

  const applyServerCount = useCallback((payload: unknown) => {
    const parsed = unreadCountSchema.safeParse(payload);
    if (parsed.success) setUnread(parsed.data.unreadCount);
  }, []);

  const setReadState = useCallback(
    async (item: InboxItem, next: boolean) => {
      if (item.read === next) return;
      const isMention = item.type === 'mention';
      const applyLocally = (read: boolean, step: number) => {
        setRows((list) => list.map((row) => (row.id === item.id ? { ...row, read } : row)));
        if (isMention) setMentions((count) => Math.max(0, count + step));
        setUnread((count) => Math.max(0, count + step));
      };

      applyLocally(next, next ? -1 : 1);
      try {
        applyServerCount(
          await apiRequest('/api/notifications/read', {
            method: 'POST',
            body: { notificationIds: [item.id], read: next },
          }),
        );
      } catch (cause) {
        applyLocally(item.read, next ? 1 : -1);
        setError('That did not save. Check your connection and try again.');
        throw cause;
      }
    },
    [applyServerCount],
  );

  const toggleRead = useCallback(async () => {
    if (current === undefined) return;
    await setReadState(current, !current.read);
  }, [current, setReadState]);

  const open = useCallback(
    (item: InboxItem) => {
      setSelectedId(item.id);
      setReadState(item, true).catch(() => undefined);
    },
    [setReadState],
  );

  const snooze = useCallback(async () => {
    if (current === undefined) return;
    const snoozedUntil = new Date(Date.now() + SNOOZE_HOURS * 3_600_000).toISOString();
    setRows((list) => list.map((row) => (row.id === current.id ? { ...row, snoozedUntil } : row)));
    applyServerCount(
      await apiRequest(`/api/notifications/${current.id}`, {
        method: 'PATCH',
        body: { snoozeHours: SNOOZE_HOURS },
      }),
    );
  }, [current, applyServerCount]);

  const remove = useCallback(async () => {
    if (current === undefined) return;
    const wasUnreadMention = !current.read && current.type === 'mention';
    setRows((list) => list.filter((row) => row.id !== current.id));
    if (wasUnreadMention) setMentions((count) => Math.max(0, count - 1));
    applyServerCount(await apiRequest(`/api/notifications/${current.id}`, { method: 'DELETE' }));
  }, [current, applyServerCount]);

  useHotkey('j', () => move(1), {
    label: 'Next notification',
    section: 'Navigation',
    scope: 'inbox',
    aliases: ['down'],
  });
  useHotkey('k', () => move(-1), {
    label: 'Previous notification',
    section: 'Navigation',
    scope: 'inbox',
    aliases: ['up'],
  });
  useHotkey(
    'u',
    () => {
      toggleRead();
    },
    { label: 'Toggle read', section: 'General', scope: 'inbox' },
  );
  useHotkey(
    'h',
    () => {
      snooze();
    },
    { label: 'Snooze for a day', section: 'General', scope: 'inbox' },
  );
  useHotkey(
    'backspace',
    () => {
      remove();
    },
    { label: 'Delete notification', section: 'General', scope: 'inbox' },
  );

  return (
    <div className="flex min-h-0 flex-col md:h-full">
      <header className="flex flex-col gap-2 border-border border-b px-5 py-2">
        {error === null ? null : (
          <p role="alert" className="text-danger text-xs" data-testid="inbox-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="flex shrink-0 items-center gap-2 font-semibold text-base text-text">
            Inbox
            <Badge tone={unread > 0 ? 'accent' : 'neutral'} data-testid="inbox-unread-count">
              {unread} unread
            </Badge>
            {mentions > 0 ? (
              <Badge tone="warning" data-testid="inbox-mention-count">
                @ {mentions}
              </Badge>
            ) : null}
          </h1>
          <nav className="flex items-center gap-1" aria-label="Inbox filters">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectTab(entry.id)}
                aria-current={tab === entry.id ? 'true' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1 text-dense transition-colors duration-[var(--duration-fast)]',
                  tab === entry.id
                    ? 'bg-surface-2 font-medium text-text'
                    : 'text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <p className="ml-auto hidden items-center gap-1.5 text-2xs text-faint xl:flex">
            <Kbd keys={['J']} />
            <Kbd keys={['K']} /> move
            <Kbd keys={['U']} /> read
            <Kbd keys={['H']} /> snooze
            <Kbd keys={['Backspace']} /> delete
          </p>
        </div>
      </header>

      {visible.length === 0 && cursor === null ? (
        <EmptyState
          icon={<Bell strokeWidth={1.75} aria-hidden="true" />}
          title="Inbox zero"
          description="When somebody assigns you an issue, mentions you, replies to you, or changes something you follow, it lands here. Your own actions do not."
          className="flex-1"
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[22rem_minmax(0,1fr)]">
          <ul className="flex min-h-0 flex-col border-border md:overflow-y-auto md:border-r">
            {visible.map((row) => {
              const Icon = SOURCE_ICONS[row.type];
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => open(row)}
                    aria-current={current?.id === row.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-2.5 border-border border-b px-3 py-2.5 text-left',
                      'transition-colors duration-[var(--duration-fast)]',
                      current?.id === row.id ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        row.read ? 'bg-transparent' : 'bg-accent',
                      )}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{row.read ? 'Read' : 'Unread'}</span>
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          'truncate text-dense',
                          row.read ? 'text-muted' : 'font-medium text-text',
                        )}
                      >
                        {row.title}
                      </span>
                      <span className="truncate text-2xs text-faint">
                        {row.actorName} · {relativeTime(new Date(row.createdAt))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {cursor === null ? null : (
              <li key="load-more">
                <LoadMoreRow loading={loadingMore} onReach={loadMore} />
                {pagingError === null ? null : (
                  <p
                    role="alert"
                    data-testid="inbox-paging-error"
                    className="px-3 pb-3 text-center text-2xs text-danger"
                  >
                    {pagingError}
                  </p>
                )}
              </li>
            )}
          </ul>

          <section className="flex min-h-0 min-w-0 flex-col" data-testid="inbox-detail">
            {current === undefined ? (
              <p className="p-5 text-faint text-xs">Pick a notification.</p>
            ) : (
              <NotificationDetail
                item={current}
                onOpen={() => {
                  setReadState(current, true).catch(() => undefined);
                }}
                canWriteDocs={canWriteDocs}
                canPublishDocs={canPublishDocs}
                onIssueDeleted={leaveDeletedIssue}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
