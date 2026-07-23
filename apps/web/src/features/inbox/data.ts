import { db } from '@orbit/db';
import { listInbox, unreadCounters } from '@orbit/services/notifications';
import type { NotificationType } from '@orbit/shared/constants';
import { NOTIFICATION_TYPES } from '@orbit/shared/constants';
import type { Principal } from '@orbit/shared/policy';

export interface InboxItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly actorName: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly read: boolean;
  readonly snoozedUntil: string | null;
  readonly createdAt: string;
}

export interface InboxData {
  readonly items: InboxItem[];
  readonly unreadCount: number;
  readonly unreadMentions: number;
}

function toType(value: string): NotificationType {
  return NOTIFICATION_TYPES.find((entry) => entry === value) ?? 'subscription_activity';
}

export async function loadInbox(principal: Principal): Promise<InboxData> {
  const [page, counters] = await Promise.all([
    listInbox(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      limit: 50,
    }),
    unreadCounters(db, principal.userId, principal.organizationId),
  ]);
  return {
    unreadCount: counters.total,
    unreadMentions: counters.mentions,
    items: page.items.map((row) => ({
      id: row.id,
      type: toType(row.type),
      actorName: row.actorName,
      title: row.title,
      body: row.body,
      url: row.url,
      read: row.readAt !== null,
      snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
