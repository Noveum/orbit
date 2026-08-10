'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import { useCallback } from 'react';
import { fetchRealtimeTicket } from '@/lib/realtime/ticket.ts';
import { resolveRealtimeUrl } from '@/lib/realtime/url.ts';
import type { InboxItem } from './data.ts';
import { InboxView } from './inbox-view.tsx';

export interface InboxRealtimeProps {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly unreadMentions: number;
  readonly nextCursor: string | null;
  readonly userId: string;
  readonly organizationId: string;
  readonly realtimeUrl: string;
  readonly canWriteDocs: boolean;
  readonly canPublishDocs: boolean;
}

export function InboxRealtime({
  items,
  unreadCount,
  unreadMentions,
  nextCursor,
  userId,
  organizationId,
  realtimeUrl,
  canWriteDocs,
  canPublishDocs,
}: InboxRealtimeProps) {
  const fetchTicket = useCallback(() => fetchRealtimeTicket(organizationId), [organizationId]);
  const socketUrl =
    typeof window === 'undefined'
      ? realtimeUrl
      : resolveRealtimeUrl(realtimeUrl, window.location.origin);
  return (
    <RealtimeProvider url={socketUrl} organizationId={organizationId} fetchTicket={fetchTicket}>
      <InboxView
        items={items}
        unreadCount={unreadCount}
        unreadMentions={unreadMentions}
        nextCursor={nextCursor}
        userId={userId}
        canWriteDocs={canWriteDocs}
        canPublishDocs={canPublishDocs}
      />
    </RealtimeProvider>
  );
}
