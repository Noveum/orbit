import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AiConnectBanner } from '@/features/ai-connect/ai-connect-banner.tsx';
import { aiConnectHintVisible } from '@/features/ai-connect/load-ai-connect-hint.ts';
import { MyIssuesView } from '@/features/issues/my-issues-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { mcpServerUrl } from '@/lib/env.ts';
import { dehydratedAssignedIssues } from '@/lib/query/prefetch.ts';

export const metadata: Metadata = { title: 'My issues' };

export default async function MyIssuesPage() {
  const { principal } = await pageContext();
  const [dehydrated, showHint] = await Promise.all([
    dehydratedAssignedIssues(principal),
    aiConnectHintVisible(principal.userId),
  ]);
  return (
    <HydrationBoundary state={dehydrated}>
      <MyIssuesView banner={showHint ? <AiConnectBanner mcpUrl={mcpServerUrl()} /> : null} />
    </HydrationBoundary>
  );
}
