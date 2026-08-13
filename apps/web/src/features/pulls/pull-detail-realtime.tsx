'use client';

import type { PullRequestDetail } from './data.ts';
import { PullDetail } from './pull-detail.tsx';
import { usePullRefresh } from './use-pull-refresh.ts';

export function PullDetailRealtime({ pull }: { readonly pull: PullRequestDetail }) {
  usePullRefresh();
  return <PullDetail pull={pull} />;
}
