'use client';

import type { GithubReach, PullRequestRow } from './data.ts';
import { PullsView } from './pulls-view.tsx';

export interface PullsRealtimeProps {
  readonly pulls: readonly PullRequestRow[];
  readonly total: number;
  readonly userId: string;
  readonly reach: GithubReach;
  readonly canManageIntegrations: boolean;
  readonly currentPage: number;
  readonly hasMore: boolean;
}

export function PullsRealtime({
  pulls,
  total,
  userId,
  reach,
  canManageIntegrations,
  currentPage,
  hasMore,
}: PullsRealtimeProps) {
  return (
    <PullsView
      pulls={pulls}
      total={total}
      userId={userId}
      reach={reach}
      canManageIntegrations={canManageIntegrations}
      currentPage={currentPage}
      hasMore={hasMore}
    />
  );
}
