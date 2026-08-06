import { can } from '@orbit/shared/policy';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { DocsEmptyPane } from '@/features/docs/docs-empty-pane.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedDocsHome } from '@/lib/query/docs-prefetch.ts';

export const metadata: Metadata = { title: 'Docs' };

export default async function DocsPage() {
  const { principal } = await pageContext();
  return (
    <HydrationBoundary state={await dehydratedDocsHome(principal)}>
      <DocsEmptyPane canWrite={can(principal, 'doc:write')} />
    </HydrationBoundary>
  );
}
