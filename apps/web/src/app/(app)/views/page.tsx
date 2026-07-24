import { listViews } from '@orbit/core';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { ViewsPage } from '@/features/views/views-page.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { toViewPayload } from '@/lib/api/views.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { viewListSchema } from '@/lib/query/schemas.ts';

export const metadata: Metadata = { title: 'Views' };

export default async function Views() {
  const { principal } = await pageContext();
  const rows = await listViews(principal);
  const client = new QueryClient();
  client.setQueryData(
    queryKeys.views(),
    viewListSchema.parse(JSON.parse(JSON.stringify({ views: rows.map(toViewPayload) }))).views,
  );

  return (
    <HydrationBoundary state={dehydrate(client)}>
      <ViewsPage />
    </HydrationBoundary>
  );
}
