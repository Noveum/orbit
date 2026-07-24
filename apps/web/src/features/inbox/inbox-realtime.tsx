'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import { useCallback } from 'react';
import { fetchRealtimeTicket } from '@/lib/realtime/ticket.ts';
import type { InboxItem } from './data.ts';
import { InboxView } from './inbox-view.tsx';

export interface InboxRealtimeProps {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly unreadMentions: number;
  readonly userId: string;
  readonly organizationId: string;
  readonly realtimeUrl: string;
}

export function InboxRealtime({
  items,
  unreadCount,
  unreadMentions,
  userId,
  organizationId,
  realtimeUrl,
}: InboxRealtimeProps) {
  const fetchTicket = useCallback(() => fetchRealtimeTicket(organizationId), [organizationId]);
  return (
    <RealtimeProvider url={realtimeUrl} organizationId={organizationId} fetchTicket={fetchTicket}>
      <InboxView
        items={items}
        unreadCount={unreadCount}
        unreadMentions={unreadMentions}
        userId={userId}
      />
    </RealtimeProvider>
  );
}
