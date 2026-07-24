import { can } from '@orbit/shared/policy';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { DocSurface } from '@/features/docs/doc-surface.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedDoc } from '@/lib/query/docs-prefetch.ts';

export const metadata: Metadata = { title: 'Docs' };

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ principal }, { id }, query] = await Promise.all([pageContext(), params, searchParams]);

  return (
    <HydrationBoundary state={await dehydratedDoc(principal, id)}>
      <DocSurface
        docId={id}
        canWrite={can(principal, 'doc:write')}
        canPublish={can(principal, 'doc:publish')}
        startEditing={query.edit === '1'}
      />
    </HydrationBoundary>
  );
}
