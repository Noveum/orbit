'use client';

import type { InboxItem } from './data.ts';
import { InboxView } from './inbox-view.tsx';

export interface InboxRealtimeProps {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly unreadMentions: number;
  readonly unreadActivity: number;
  readonly nextCursor: string | null;
  readonly userId: string;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
}

export function InboxRealtime({
  items,
  unreadCount,
  unreadMentions,
  unreadActivity,
  nextCursor,
  userId,
  canWriteDocs,
  canPublishDocs,
}: InboxRealtimeProps) {
  return (
    <InboxView
      items={items}
      unreadCount={unreadCount}
      unreadMentions={unreadMentions}
      unreadActivity={unreadActivity}
      nextCursor={nextCursor}
      userId={userId}
      canWriteDocs={canWriteDocs}
      canPublishDocs={canPublishDocs}
    />
  );
}
