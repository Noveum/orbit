'use client';

import {
  useDeltaHandler,
  useResumeHandler,
  useScopeSubscription,
} from '@orbit/realtime-client/react';
import { scopes } from '@orbit/shared/events';
import {
  INBOX_TABS,
  type InboxConversation,
  type InboxConversationPage,
  type InboxCounterSnapshot,
  type InboxTab,
  inboxConversationDeltaSchema,
  inboxConversationMutationSchema,
  inboxConversationPageSchema,
  inboxHistoryPageSchema,
} from '@orbit/shared/validators';
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { CommentBody } from '@/features/comments/comment-thread.tsx';
import { ApiRequestError, apiRequest } from '@/lib/api/client.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import {
  ConversationHeader,
  ConversationRow,
  ConversationToolbar,
} from './conversation-controls.tsx';
import {
  currentConversationRows,
  newestCounterSnapshot,
  upsertConversationPages,
} from './conversation-state.ts';
import { docIdFromUrl, issueIdentifierFromUrl } from './inbox-links.ts';
import { NotificationBody } from './inbox-view.tsx';

export interface ConversationInboxProps {
  readonly initialPage: InboxConversationPage;
  readonly userId: string;
  readonly organizationId: string;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
}

function ConversationHistory({ row }: { readonly row: InboxConversation }) {
  const history = useInfiniteQuery({
    queryKey: ['inbox-history', row.id, row.latestEventId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      inboxHistoryPageSchema.parse(
        await apiRequest(
          `/api/inbox/conversations/${row.id}/events${pageParam === null ? '' : `?cursor=${encodeURIComponent(pageParam)}`}`,
        ),
      ),
    getNextPageParam: (page) => page.nextCursor,
  });
  if (history.isPending)
    return (
      <p role="status" className="p-5 text-muted text-sm">
        Loading conversation history...
      </p>
    );
  if (history.isError)
    return (
      <p role="alert" className="p-5 text-danger text-sm">
        Could not load this conversation.{' '}
        <button type="button" className="underline" onClick={() => history.refetch()}>
          Try again
        </button>
      </p>
    );
  const events = history.data.pages.flatMap((page) => page.events);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="inbox-conversation-history">
      <ol aria-label="Conversation history" className="divide-y divide-border">
        {events.map((event) => (
          <li key={event.id} className="px-5 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                <span className="font-medium text-text">{event.actorName}</span> ·{' '}
                <RelativeTime at={event.occurredAt} />
              </p>
              {event.externalUrl === null ? null : (
                <a
                  href={event.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-2xs text-accent hover:underline"
                >
                  View on GitHub
                </a>
              )}
            </div>
            <p className="mb-2 font-medium text-sm text-text">{event.title}</p>
            {event.body.length === 0 ? null : (
              <CommentBody body={event.body} bodyHtml={event.bodyHtml} />
            )}
          </li>
        ))}
      </ol>
      {history.hasNextPage ? (
        <button
          type="button"
          disabled={history.isFetchingNextPage}
          onClick={() => history.fetchNextPage()}
          className="w-full px-5 py-3 text-accent text-xs"
        >
          {history.isFetchingNextPage ? 'Loading...' : 'Load older updates'}
        </button>
      ) : null}
    </div>
  );
}

function ConversationDetail({
  row,
  canWriteDocs,
  canPublishDocs,
}: {
  readonly row: InboxConversation;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
}) {
  const [context, setContext] = useState(false);
  const issue = issueIdentifierFromUrl(row.url);
  const doc = docIdFromUrl(row.url);
  const hasContext = issue !== null || doc !== null;
  return (
    <>
      <header className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate font-medium text-sm text-text">{row.title}</h2>
          {row.externalUrl === null ? null : (
            <a
              href={row.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs text-accent hover:underline"
            >
              Open on GitHub
            </a>
          )}
          <Link
            href={row.url}
            data-testid="inbox-open-link"
            className="shrink-0 text-xs text-accent hover:underline"
          >
            Open in Orbit
          </Link>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-faint">
          <span>
            {row.eventCount} {row.eventCount === 1 ? 'update' : 'updates'} in this conversation
          </span>
          {hasContext ? (
            <button
              type="button"
              aria-pressed={context}
              onClick={() => setContext((value) => !value)}
              className="text-accent hover:underline"
            >
              {context ? 'Show conversation' : `Show ${issue === null ? 'document' : 'issue'}`}
            </button>
          ) : null}
        </div>
      </header>
      {context && hasContext ? (
        <NotificationBody
          item={{
            id: row.id,
            type: row.type,
            entityType: row.subjectType,
            entityId: row.subjectId,
            actorName: row.actorName,
            title: row.title,
            body: row.body,
            bodyHtml: row.bodyHtml,
            url: row.url,
            externalUrl: row.externalUrl,
            read: row.read,
            snoozedUntil: row.snoozedUntil,
            createdAt: row.occurredAt ?? row.lastActivityAt ?? new Date(0).toISOString(),
          }}
          canWriteDocs={canWriteDocs}
          canPublishDocs={canPublishDocs}
          onIssueDeleted={() => setContext(false)}
        />
      ) : (
        <ConversationHistory row={row} />
      )}
    </>
  );
}

export function ConversationInbox({
  initialPage,
  userId,
  organizationId,
  canWriteDocs,
  canPublishDocs,
}: ConversationInboxProps) {
  const client = useQueryClient();
  const [tab, setTab] = useState<InboxTab>('activity');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<InboxCounterSnapshot>(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const versions = useRef(new Map(initialPage.conversations.map((row) => [row.id, row.syncId])));
  const prefix = useMemo(
    () => ['inbox-conversations', organizationId, userId] as const,
    [organizationId, userId],
  );
  const list = useInfiniteQuery({
    queryKey: [...prefix, tab],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      inboxConversationPageSchema.parse(
        await apiRequest(
          `/api/inbox/conversations?tab=${tab}${pageParam === null ? '' : `&cursor=${encodeURIComponent(pageParam)}`}`,
        ),
      ),
    getNextPageParam: (page) => page.nextCursor,
    ...(tab === 'activity' ? { initialData: { pages: [initialPage], pageParams: [null] } } : {}),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(
    () => currentConversationRows(list.data?.pages ?? [], versions.current),
    [list.data],
  );
  const current = rows.find((row) => row.id === selectedId) ?? rows[0];

  const applySnapshot = useCallback((incoming: InboxCounterSnapshot) => {
    setSnapshot((previous) => newestCounterSnapshot(previous, incoming));
  }, []);
  useEffect(() => {
    for (const page of list.data?.pages ?? []) applySnapshot(page);
  }, [list.data, applySnapshot]);

  const applyChanges = useCallback(
    (
      changes: readonly InboxConversation[],
      removed: ReadonlySet<string>,
      counters: InboxCounterSnapshot,
    ) => {
      applySnapshot(counters);
      for (const selectedTab of INBOX_TABS)
        client.setQueryData<InfiniteData<InboxConversationPage, string | null>>(
          [...prefix, selectedTab],
          (previous) => upsertConversationPages(previous, changes, removed, selectedTab, counters),
        );
    },
    [applySnapshot, client, prefix],
  );

  useScopeSubscription([scopes.user(userId)]);
  useResumeHandler(
    useCallback(() => {
      apiRequest(`/api/inbox/conversations?tab=${tab}`)
        .then((payload) => {
          const page = inboxConversationPageSchema.parse(payload);
          client.setQueryData([...prefix, tab], { pages: [page], pageParams: [null] });
          applySnapshot(page);
        })
        .catch(() => setError('Could not refresh the inbox after reconnecting.'));
    }, [applySnapshot, client, prefix, tab]),
  );
  useDeltaHandler(
    useCallback(
      (actions) => {
        for (const action of actions) {
          if (
            action.model !== 'notification_conversation' ||
            action.organizationId !== organizationId
          )
            continue;
          const parsed = inboxConversationDeltaSchema.safeParse(action.data);
          if (!parsed.success) continue;
          const delta = parsed.data;
          applySnapshot(delta);
          if ((versions.current.get(delta.id) ?? -1) > delta.syncId) continue;
          versions.current.set(delta.id, delta.syncId);
          if (!delta.visible) {
            applyChanges([], new Set([delta.id]), delta);
            continue;
          }
          apiRequest(`/api/inbox/conversations/${delta.id}`)
            .then((payload) => {
              if (versions.current.get(delta.id) !== delta.syncId) return;
              const result = inboxConversationMutationSchema.parse(payload);
              applyChanges(result.conversations, new Set(), result);
            })
            .catch((cause: unknown) => {
              if (
                cause instanceof ApiRequestError &&
                (cause.is('not_found') || cause.is('forbidden')) &&
                versions.current.get(delta.id) === delta.syncId
              ) {
                applyChanges([], new Set([delta.id]), delta);
              }
            });
        }
      },
      [applyChanges, applySnapshot, organizationId],
    ),
  );

  const mutate = useCallback(
    async (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: Record<string, unknown>) => {
      if (saving) return;
      setSaving(true);
      setError(null);
      try {
        const result = inboxConversationMutationSchema.parse(
          await apiRequest(path, { method, ...(body === undefined ? {} : { body }) }),
        );
        for (const row of result.conversations)
          versions.current.set(row.id, Math.max(versions.current.get(row.id) ?? 0, row.syncId));
        applyChanges(result.conversations, new Set(), result);
      } catch {
        setError('That did not save. Check your connection and try again.');
      } finally {
        setSaving(false);
      }
    },
    [applyChanges, saving],
  );
  const markRead = useCallback(
    (row: InboxConversation, read: boolean) =>
      mutate('/api/inbox/conversations/read', 'POST', { conversationIds: [row.id], read }),
    [mutate],
  );
  const snooze = useCallback(
    () =>
      current === undefined
        ? undefined
        : mutate(`/api/inbox/conversations/${current.id}`, 'PATCH', {
            snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(),
          }),
    [current, mutate],
  );
  const dismiss = useCallback(
    () =>
      current === undefined
        ? undefined
        : mutate(`/api/inbox/conversations/${current.id}`, 'DELETE'),
    [current, mutate],
  );
  const move = useCallback(
    (direction: number) => {
      const index = Math.max(
        0,
        rows.findIndex((row) => row.id === current?.id),
      );
      setSelectedId(rows[Math.min(Math.max(index + direction, 0), rows.length - 1)]?.id ?? null);
    },
    [rows, current],
  );
  useHotkey('j', () => move(1), {
    label: 'Next conversation',
    section: 'Navigation',
    scope: 'inbox',
    aliases: ['down'],
  });
  useHotkey('k', () => move(-1), {
    label: 'Previous conversation',
    section: 'Navigation',
    scope: 'inbox',
    aliases: ['up'],
  });
  useHotkey(
    'u',
    () => {
      if (current !== undefined) markRead(current, !current.read);
    },
    { label: 'Toggle read', section: 'General', scope: 'inbox' },
  );
  useHotkey(
    'h',
    () => {
      snooze();
    },
    { label: 'Snooze conversation', section: 'General', scope: 'inbox' },
  );
  useHotkey(
    'backspace',
    () => {
      dismiss();
    },
    { label: 'Dismiss conversation', section: 'General', scope: 'inbox' },
  );

  let content: ReactNode;
  if (list.isPending)
    content = (
      <p role="status" className="p-5 text-muted text-sm">
        Loading conversations...
      </p>
    );
  else if (list.isError)
    content = (
      <p role="alert" className="p-5 text-danger text-sm">
        Could not load the inbox.{' '}
        <button type="button" onClick={() => list.refetch()} className="underline">
          Try again
        </button>
      </p>
    );
  else if (rows.length === 0)
    content = (
      <EmptyState
        icon={<Bell aria-hidden="true" />}
        title="All caught up"
        description="Updates for the same pull request, document, or issue stay together in one conversation. New activity will appear here."
        className="flex-1"
      />
    );
  else
    content = (
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-border md:border-r">
          <ul aria-label="Inbox conversations">
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                current={current?.id === row.id}
                onOpen={(selected) => {
                  setSelectedId(selected.id);
                  if (!selected.read) markRead(selected, true);
                }}
              />
            ))}
          </ul>
          {list.hasNextPage ? (
            <button
              type="button"
              data-testid="inbox-load-more"
              disabled={list.isFetchingNextPage}
              onClick={() => list.fetchNextPage()}
              className="w-full px-4 py-3 text-xs text-accent"
            >
              {list.isFetchingNextPage ? 'Loading...' : 'Load older conversations'}
            </button>
          ) : null}
        </div>
        <section className="flex min-h-0 min-w-0 flex-col" data-testid="inbox-detail">
          {current === undefined ? null : (
            <>
              <ConversationToolbar
                read={current.read}
                saving={saving}
                onToggleRead={() => markRead(current, !current.read)}
                onSnooze={() => snooze()}
                onDismiss={() => dismiss()}
              />
              <ConversationDetail
                key={current.id}
                row={current}
                canWriteDocs={canWriteDocs}
                canPublishDocs={canPublishDocs}
              />
            </>
          )}
        </section>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-col bg-surface md:h-full">
      <ConversationHeader
        snapshot={snapshot}
        tab={tab}
        saving={saving}
        error={error}
        onSelectTab={(nextTab) => {
          setTab(nextTab);
          setSelectedId(null);
        }}
        onReadAll={() => mutate('/api/inbox/conversations/read-all', 'POST')}
      />
      {content}
    </div>
  );
}
