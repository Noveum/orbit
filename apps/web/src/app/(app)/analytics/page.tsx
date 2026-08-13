import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AnalyticsCockpitDataBoundary } from '@/features/analytics/analytics-cockpit-data-boundary.tsx';
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
      <div className="flex flex-col gap-6 px-6 py-6">
        <header className="flex flex-col gap-3">
          <h1 className="font-semibold text-lg text-text">Analytics</h1>
          <p className="text-muted text-xs">
            Scope, throughput, churn and distributions across the workspace.
          </p>
        </header>
        <AnalyticsCockpitDataBoundary query={query} />
      </div>
    </HydrationBoundary>
  );
}
