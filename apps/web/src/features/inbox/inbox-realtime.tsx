'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import type { InboxItem } from './data.ts';
import { InboxView } from './inbox-view.tsx';

export interface InboxRealtimeProps {
  readonly items: readonly InboxItem[];
  readonly unreadCount: number;
  readonly userId: string;
  readonly organizationId: string;
  readonly realtimeUrl: string;
  readonly token: string;
}

export function InboxRealtime({
  items,
  unreadCount,
  userId,
  organizationId,
  realtimeUrl,
  token,
}: InboxRealtimeProps) {
  return (
    <RealtimeProvider url={realtimeUrl} token={token} organizationId={organizationId}>
      <InboxView items={items} unreadCount={unreadCount} userId={userId} />
    </RealtimeProvider>
  );
}
