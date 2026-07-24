import type { Metadata } from 'next';
import { loadPullRequests } from '@/features/pulls/data.ts';
import { PullsRealtime } from '@/features/pulls/pulls-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Pull requests' };

const DEFAULT_REALTIME_URL = 'ws://localhost:3100';

export default async function PullsPage() {
  const context = await pageContext();
  const pulls = await loadPullRequests(context.principal);

  return (
    <PullsRealtime
      pulls={pulls}
      userId={context.principal.userId}
      organizationId={context.principal.organizationId}
      realtimeUrl={process.env['NEXT_PUBLIC_REALTIME_URL'] ?? DEFAULT_REALTIME_URL}
      token={context.sessionToken}
    />
  );
}
