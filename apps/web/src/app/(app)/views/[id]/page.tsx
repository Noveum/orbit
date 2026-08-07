import { listViews, type ViewRecord } from '@orbit/core';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { cache } from 'react';
import { SavedViewPage } from '@/features/views/saved-view-page.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { toViewPayload } from '@/lib/api/views.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { viewListSchema } from '@/lib/query/schemas.ts';

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export function viewIdFrom(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

const loadViews = cache(async (): Promise<ViewRecord[]> => {
  const { principal } = await pageContext();
  return await listViews(principal);
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const viewId = viewIdFrom(id);
  const rows = await loadViews();
  return { title: rows.find((entry) => entry.id === viewId)?.name ?? 'View' };
}

export default async function SavedView({ params }: PageProps) {
  const { id } = await params;
  const viewId = viewIdFrom(id);
  const rows = await loadViews();
  const client = new QueryClient();
  client.setQueryData(
    queryKeys.views(),
    viewListSchema.parse(JSON.parse(JSON.stringify({ views: rows.map(toViewPayload) }))).views,
  );

  return (
    <HydrationBoundary state={dehydrate(client)}>
      <SavedViewPage viewId={viewId} />
    </HydrationBoundary>
  );
}
