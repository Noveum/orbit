import { getOnboardingStatus, listMcpGrants } from '@orbit/core';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AiConnectBanner } from '@/features/ai-connect/ai-connect-banner.tsx';
import { shouldShowAiConnectHint } from '@/features/ai-connect/ai-connect-hint.ts';
import { MyIssuesView } from '@/features/issues/my-issues-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedAssignedIssues } from '@/lib/query/prefetch.ts';

export const metadata: Metadata = { title: 'My issues' };

export default async function MyIssuesPage() {
  const { principal } = await pageContext();
  const [dehydrated, onboarding, grants] = await Promise.all([
    dehydratedAssignedIssues(principal),
    getOnboardingStatus(principal.userId),
    listMcpGrants(principal.userId),
  ]);
  const showHint = shouldShowAiConnectHint(onboarding.state, grants.length);
  return (
    <HydrationBoundary state={dehydrated}>
      <MyIssuesView banner={showHint ? <AiConnectBanner /> : null} />
    </HydrationBoundary>
  );
}
