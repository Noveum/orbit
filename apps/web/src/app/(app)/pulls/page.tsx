import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { githubReach, loadPullRequests } from '@/features/pulls/data.ts';
import { PullsRealtime } from '@/features/pulls/pulls-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { configuredRealtimeUrl } from '@/lib/realtime/url.ts';

export const metadata: Metadata = { title: 'Pull requests' };

export default async function PullsPage() {
  const context = await pageContext();
  const [pulls, reach] = await Promise.all([
    loadPullRequests(context.principal),
    githubReach(context.principal),
  ]);

  return (
    <PullsRealtime
      pulls={pulls}
      userId={context.principal.userId}
      organizationId={context.principal.organizationId}
      realtimeUrl={configuredRealtimeUrl()}
      reach={reach}
      canManageIntegrations={can(context.principal, 'integration:manage')}
    />
  );
}
