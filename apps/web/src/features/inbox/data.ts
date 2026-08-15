import { db } from '@orbit/db';
import { renderMarkdown } from '@orbit/services/markdown';
import { listInbox, type NotificationRecord, unreadCounters } from '@orbit/services/notifications';
import type { NotificationType } from '@orbit/shared/constants';
import { NOTIFICATION_TYPES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';

export const INBOX_PAGE_SIZE = 50;

export interface InboxItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly entityType: string;
  readonly entityId: string;
  readonly actorName: string;
  readonly title: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly url: string;
  readonly externalUrl: string | null;
  readonly read: boolean;
  readonly snoozedUntil: string | null;
  readonly createdAt: string;
}

export interface InboxData {
  readonly items: InboxItem[];
  readonly unreadCount: number;
  readonly unreadMentions: number;
  readonly unreadActivity: number;
  readonly nextCursor: string | null;
}

function toType(value: string): NotificationType {
  return NOTIFICATION_TYPES.find((entry) => entry === value) ?? 'subscription_activity';
}

export function toInboxItem(row: NotificationRecord): InboxItem {
  return {
    id: row.id,
    type: toType(row.type),
    entityType: row.entityType,
    entityId: row.entityId,
    actorName: row.actorName,
    title: row.title,
    body: row.body,
    bodyHtml: renderMarkdown(row.body),
    url: row.url,
    externalUrl: row.externalUrl,
    read: row.readAt !== null,
    snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadInbox(principal: Principal): Promise<InboxData> {
  const [page, counters] = await Promise.all([
    listInbox(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      limit: INBOX_PAGE_SIZE,
    }),
    unreadCounters(db, principal.userId, principal.organizationId),
  ]);
  return {
    unreadCount: counters.total,
    unreadMentions: counters.mentions,
    unreadActivity: counters.activity,
    nextCursor: page.nextCursor,
    items: page.items.map(toInboxItem),
  };
}
