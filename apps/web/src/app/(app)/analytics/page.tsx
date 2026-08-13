import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AnalyticsCockpit } from '@/features/analytics/analytics-cockpit.tsx';
import { dehydratedAnalyticsLens } from '@/features/analytics/data.ts';
import { parseAnalyticsSearchParams } from '@/features/analytics/query-state.ts';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Analytics' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const [{ principal }, params] = await Promise.all([pageContext(), searchParams]);
  const query = parseAnalyticsSearchParams(params);

  return (
    <HydrationBoundary state={await dehydratedAnalyticsLens(principal, query)}>
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <AnalyticsCockpit initialQuery={query} />
      </div>
    </HydrationBoundary>
  );
}
