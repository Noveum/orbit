'use client';

import {
  INBOX_TABS,
  type InboxConversation,
  type InboxCounterSnapshot,
  type InboxTab,
} from '@orbit/shared/validators';
import { CheckCheck, Clock, FileText, GitPullRequest, MessageSquare, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover, tabHover } from '@/lib/interaction.ts';

const TAB_LABELS: Record<InboxTab, string> = {
  activity: 'Activity',
  unread: 'Unread',
  mentions: 'Mentions',
  pulls: 'Pull requests',
  status: 'Status',
};
const BUTTON_STYLE =
  'rounded-md p-1.5 text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent';

export function ConversationHeader({
  snapshot,
  tab,
  saving,
  error,
  onSelectTab,
  onReadAll,
}: {
  readonly snapshot: InboxCounterSnapshot;
  readonly tab: InboxTab;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onSelectTab: (tab: InboxTab) => void;
  readonly onReadAll: () => void;
}) {
  return (
    <header className="border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="flex items-center gap-2 font-semibold text-base text-text">
          Inbox{' '}
          <Badge
            tone={snapshot.counters.unreadCount > 0 ? 'accent' : 'neutral'}
            data-testid="inbox-unread-count"
          >
            {snapshot.counters.unreadCount} unread
          </Badge>
          {snapshot.counters.unreadMentionCount > 0 ? (
            <Badge tone="warning" data-testid="inbox-mention-count">
              @ {snapshot.counters.unreadMentionCount}
            </Badge>
          ) : null}
        </h1>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Inbox filters">
          {INBOX_TABS.map((entry) => (
            <button
              key={entry}
              type="button"
              data-testid={`inbox-tab-${entry}`}
              aria-current={entry === tab ? 'true' : undefined}
              onClick={() => onSelectTab(entry)}
              className={cn(
                'rounded-md px-2.5 py-1 text-dense',
                entry === tab
                  ? 'bg-accent-soft font-medium text-accent'
                  : cn(tabHover, 'text-muted'),
              )}
            >
              {TAB_LABELS[entry]}
              {entry === 'activity' && snapshot.counters.unreadActivityCount > 0 ? (
                <span data-testid="inbox-activity-count" className="ml-1.5 text-2xs tabular-nums">
                  {snapshot.counters.unreadActivityCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
        <button
          type="button"
          disabled={saving || snapshot.counters.unreadCount === 0}
          onClick={onReadAll}
          className="ml-auto text-xs text-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mark all read
        </button>
      </div>
      {error === null ? null : (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </header>
  );
}

function conversationIcon(subject: string) {
  if (subject === 'github_pull_request') return GitPullRequest;
  if (subject === 'doc') return FileText;
  return MessageSquare;
}

export function ConversationRow({
  row,
  current,
  onOpen,
}: {
  readonly row: InboxConversation;
  readonly current: boolean;
  readonly onOpen: (row: InboxConversation) => void;
}) {
  const Icon = conversationIcon(row.subjectType);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        aria-current={current ? 'true' : undefined}
        className={cn(
          'flex w-full items-start gap-2.5 border-b border-border px-3 py-3 text-left',
          rowHover,
          current ? 'bg-accent-soft/70' : null,
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
        <Icon className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-dense',
              row.read ? 'text-muted' : 'font-medium text-text',
            )}
          >
            {row.title}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-2xs text-faint">
            <span className="truncate">{row.actorName}</span> ·{' '}
            {row.occurredAt === null ? null : <RelativeTime at={row.occurredAt} />}
            <span className="ml-auto shrink-0 rounded bg-surface-2 px-1.5 py-0.5 tabular-nums">
              {row.eventCount} {row.eventCount === 1 ? 'update' : 'updates'}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function ConversationToolbar({
  read,
  saving,
  onToggleRead,
  onSnooze,
  onDismiss,
}: {
  readonly read: boolean;
  readonly saving: boolean;
  readonly onToggleRead: () => void;
  readonly onSnooze: () => void;
  readonly onDismiss: () => void;
}) {
  const readLabel = read ? 'Mark unread' : 'Mark read';
  return (
    <div className="flex items-center gap-1 border-b border-border px-4 py-1.5">
      <button
        type="button"
        className={BUTTON_STYLE}
        disabled={saving}
        onClick={onToggleRead}
        aria-label={readLabel}
        title={readLabel}
      >
        <CheckCheck className="size-4" />
      </button>
      <button
        type="button"
        className={BUTTON_STYLE}
        disabled={saving}
        onClick={onSnooze}
        aria-label="Snooze for a day"
        title="Snooze for a day"
      >
        <Clock className="size-4" />
      </button>
      <button
        type="button"
        className={BUTTON_STYLE}
        disabled={saving}
        onClick={onDismiss}
        aria-label="Dismiss conversation"
        title="Dismiss conversation"
      >
        <Trash2 className="size-4" />
      </button>
      <p className="ml-auto hidden items-center gap-1.5 text-2xs text-faint xl:flex">
        <Kbd keys={['J']} />
        <Kbd keys={['K']} /> move <Kbd keys={['U']} /> read <Kbd keys={['H']} /> snooze
      </p>
    </div>
  );
}
