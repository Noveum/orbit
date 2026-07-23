'use client';

import { useDeltaHandler, useScopeSubscription } from '@orbit/realtime-client/react';
import type { NotificationType } from '@orbit/shared/constants';
import { NOTIFICATION_TYPES } from '@orbit/shared/constants';
import type { SyncAction } from '@orbit/shared/events';
import { scopes } from '@orbit/shared/events';
import { relativeTime } from '@orbit/shared/utils';
import type { LucideIcon } from 'lucide-react';
import {
  AtSign,
  Bell,
  CircleDot,
  FileText,
  FolderKanban,
  MessageSquare,
  Smile,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { apiRequest } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import { clientId } from '@/lib/query/client-id.ts';
import type { InboxItem } from './data.ts';

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
  project_update: FolderKanban,
  reminder_due: Bell,
  triage_added: CircleDot,
  invite_accepted: UserPlus,
  member_joined: UserPlus,
};

const SNOOZE_HOURS = 24;

const notificationDeltaSchema = z.object({
  id: z.string(),
  type: z.string(),
  actorName: z.string(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  readAt: z.string().nullable(),
  snoozedUntil: z.string().nullable(),
  createdAt: z.string(),
});

const unreadCountSchema = z.object({ unreadCount: z.number() });

function toInboxItem(data: Record<string, unknown>): InboxItem | null {
  const parsed = notificationDeltaSchema.safeParse(data);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    id: row.id,
    type: NOTIFICATION_TYPES.find((entry) => entry === row.type) ?? 'subscription_activity',
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
}

function readChange(read: boolean): number {
  return read ? -1 : 1;
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
    };
  }
  if (previous === undefined) {
    if (action.action !== 'insert') return patch;
    return {
      rows: [item, ...patch.rows],
      unreadDelta: patch.unreadDelta + (item.read ? 0 : 1),
    };
  }
  const change = previous.read === item.read ? 0 : readChange(item.read);
  return {
    rows: patch.rows.map((row) => (row.id === item.id ? item : row)),
    unreadDelta: patch.unreadDelta + change,
  };
}

export function applyNotificationDeltas(
  rows: readonly InboxItem[],
  actions: readonly SyncAction[],
  tabClientId: string,
): InboxPatch {
  return actions
    .filter((action) => action.model === 'notification' && action.originClientId !== tabClientId)
    .reduce(applyOne, { rows, unreadDelta: 0 });
}

export interface InboxViewProps {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly userId: string;
}

export function InboxView({ items, unreadCount, userId }: InboxViewProps) {
  const [rows, setRows] = useState<readonly InboxItem[]>(items);
  const [unread, setUnread] = useState(unreadCount);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setRows(items);
    setUnread(unreadCount);
  }, [items, unreadCount]);

  useScopeSubscription([scopes.user(userId)]);
  useDeltaHandler(
    useCallback(
      (actions) => {
        const patch = applyNotificationDeltas(rows, actions, clientId());
        if (patch.rows !== rows) setRows(patch.rows);
        if (patch.unreadDelta !== 0) {
          setUnread((current) => Math.max(0, current + patch.unreadDelta));
        }
      },
      [rows],
    ),
  );

  const current = rows[Math.min(selected, Math.max(0, rows.length - 1))];

  const move = useCallback(
    (delta: number) => {
      setSelected((index) => Math.min(Math.max(0, index + delta), Math.max(0, rows.length - 1)));
    },
    [rows.length],
  );

  const applyServerCount = useCallback((payload: unknown) => {
    const parsed = unreadCountSchema.safeParse(payload);
    if (parsed.success) setUnread(parsed.data.unreadCount);
  }, []);

  const toggleRead = useCallback(async () => {
    if (current === undefined) return;
    const next = !current.read;
    setRows((list) => list.map((row) => (row.id === current.id ? { ...row, read: next } : row)));
    setUnread((count) => Math.max(0, count + (next ? -1 : 1)));
    applyServerCount(
      await apiRequest('/api/notifications/read', {
        method: 'POST',
        body: { notificationIds: [current.id], read: next },
      }),
    );
  }, [current, applyServerCount]);

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
    setRows((list) => list.filter((row) => row.id !== current.id));
    applyServerCount(await apiRequest(`/api/notifications/${current.id}`, { method: 'DELETE' }));
  }, [current, applyServerCount]);

  useHotkey('j', () => move(1), {
    label: 'Next notification',
    section: 'Navigation',
    scope: 'inbox',
  });
  useHotkey('k', () => move(-1), {
    label: 'Previous notification',
    section: 'Navigation',
    scope: 'inbox',
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
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-border border-b px-5 py-3">
        <h1 className="flex items-center gap-2 font-semibold text-lg text-text">
          Inbox
          <Badge tone={unread > 0 ? 'accent' : 'neutral'} data-testid="inbox-unread-count">
            {unread} unread
          </Badge>
        </h1>
        <p className="hidden items-center gap-1.5 text-2xs text-faint sm:flex">
          <Kbd keys={['J']} />
          <Kbd keys={['K']} /> move
          <Kbd keys={['U']} /> read
          <Kbd keys={['H']} /> snooze
          <Kbd keys={['Backspace']} /> delete
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Bell strokeWidth={1.75} aria-hidden="true" />}
          title="Inbox zero"
          description="Assignments, mentions, and replies land here."
          className="flex-1"
        />
      ) : (
        <div className="grid flex-1 grid-cols-1 md:grid-cols-[22rem_minmax(0,1fr)]">
          <ul className="flex flex-col border-border border-r">
            {rows.map((row, index) => {
              const Icon = SOURCE_ICONS[row.type];
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(index)}
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
          </ul>

          <section className="flex flex-col gap-3 p-5">
            {current === undefined ? (
              <p className="text-faint text-xs">Pick a notification.</p>
            ) : (
              <>
                <h2 className="font-medium text-lg text-text">{current.title}</h2>
                <p className="text-2xs text-faint">
                  {current.actorName} · {relativeTime(new Date(current.createdAt))}
                  {current.snoozedUntil === null ? '' : ' · snoozed'}
                </p>
                {current.body.length === 0 ? null : (
                  <p className="whitespace-pre-wrap text-muted text-sm">{current.body}</p>
                )}
                <Link
                  href={current.url}
                  className="w-fit rounded-sm text-accent text-dense hover:underline"
                >
                  Open in Orbit
                </Link>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
