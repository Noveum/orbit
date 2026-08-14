'use client';

import { useDeltaHandler } from '@orbit/realtime-client/react';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import type { PullRequestDetail } from './data.ts';
import { PullDetail } from './pull-detail.tsx';
import { usePullRefresh } from './use-pull-refresh.ts';

function PullDetailUpdates({ pull }: { readonly pull: PullRequestDetail }) {
  const router = useRouter();
  usePullRefresh();
  useDeltaHandler(
    useCallback(
      (actions) => {
        if (
          actions.some((action) => action.model === 'notification' || action.model === 'git_link')
        ) {
          router.refresh();
        }
      },
      [router],
    ),
  );
  return <PullDetail pull={pull} />;
}

export function PullDetailRealtime({ pull }: { readonly pull: PullRequestDetail }) {
  return <PullDetailUpdates pull={pull} />;
}
