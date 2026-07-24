import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { MyIssuesView } from '@/features/issues/my-issues-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedAssignedIssues } from '@/lib/query/prefetch.ts';

export const metadata: Metadata = { title: 'My issues' };

export default async function MyIssuesPage() {
  const { principal } = await pageContext();
  return (
    <HydrationBoundary state={await dehydratedAssignedIssues(principal)}>
      <MyIssuesView />
    </HydrationBoundary>
  );
}
