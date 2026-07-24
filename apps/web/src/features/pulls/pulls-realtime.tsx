'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import { useCallback } from 'react';
import { fetchRealtimeTicket } from '@/lib/realtime/ticket.ts';
import type { PullRequestRow } from './data.ts';
import { PullsView } from './pulls-view.tsx';

export interface PullsRealtimeProps {
  readonly pulls: readonly PullRequestRow[];
  readonly userId: string;
  readonly organizationId: string;
  readonly realtimeUrl: string;
}

export function PullsRealtime({ pulls, userId, organizationId, realtimeUrl }: PullsRealtimeProps) {
  const fetchTicket = useCallback(() => fetchRealtimeTicket(organizationId), [organizationId]);
  return (
    <RealtimeProvider url={realtimeUrl} organizationId={organizationId} fetchTicket={fetchTicket}>
      <PullsView pulls={pulls} userId={userId} />
    </RealtimeProvider>
  );
}
