'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import { useCallback } from 'react';
import { fetchRealtimeTicket } from '@/lib/realtime/ticket.ts';
import { resolveRealtimeUrl } from '@/lib/realtime/url.ts';
import type { GithubReach, PullRequestRow } from './data.ts';
import { PullsView } from './pulls-view.tsx';

export interface PullsRealtimeProps {
  readonly pulls: readonly PullRequestRow[];
  readonly userId: string;
  readonly organizationId: string;
  readonly realtimeUrl: string;
  readonly reach: GithubReach;
  readonly canManageIntegrations: boolean;
}

export function PullsRealtime({
  pulls,
  userId,
  organizationId,
  realtimeUrl,
  reach,
  canManageIntegrations,
}: PullsRealtimeProps) {
  const fetchTicket = useCallback(() => fetchRealtimeTicket(organizationId), [organizationId]);
  const socketUrl =
    typeof window === 'undefined'
      ? realtimeUrl
      : resolveRealtimeUrl(realtimeUrl, window.location.origin);
  return (
    <RealtimeProvider url={socketUrl} organizationId={organizationId} fetchTicket={fetchTicket}>
      <PullsView
        pulls={pulls}
        userId={userId}
        reach={reach}
        canManageIntegrations={canManageIntegrations}
      />
    </RealtimeProvider>
  );
}
