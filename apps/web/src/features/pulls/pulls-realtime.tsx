'use client';

import { RealtimeProvider } from '@orbit/realtime-client/react';
import type { PullRequestRow } from './data.ts';
import { PullsView } from './pulls-view.tsx';

export interface PullsRealtimeProps {
  readonly pulls: readonly PullRequestRow[];
  readonly userId: string;
  readonly organizationId: string;
  readonly realtimeUrl: string;
  readonly token: string;
}

export function PullsRealtime({
  pulls,
  userId,
  organizationId,
  realtimeUrl,
  token,
}: PullsRealtimeProps) {
  return (
    <RealtimeProvider url={realtimeUrl} token={token} organizationId={organizationId}>
      <PullsView pulls={pulls} userId={userId} />
    </RealtimeProvider>
  );
}
