import { can } from '@orbit/shared/policy';
import {
  analyticsInsightsQuerySchema,
  analyticsQuerySchema,
  insightConfigSchema,
} from '@orbit/shared/validators';
import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { AnalyticsCockpit } from '@/features/analytics/analytics-cockpit.tsx';
import {
  dehydratedAnalyticsInsights,
  dehydratedAnalyticsLens,
  loadSavedViews,
} from '@/features/analytics/data.ts';
import {
  insightConfigFromSearchParams,
  parseAnalyticsSearchParams,
} from '@/features/analytics/query-state.ts';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Analytics' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const [{ principal }, params] = await Promise.all([pageContext(), searchParams]);
  const requestedQuery = parseAnalyticsSearchParams(params);
  const savedViews = await loadSavedViews(principal);
  const cleanUrl = Object.values(params).every((value) => value === undefined);
  const pinned = savedViews.find(
    (view) =>
      view.kind === 'dashboard' &&
      view.ownerId === principal.userId &&
      view.config['pinned'] === true,
  );
  const pinnedQuery = pinned?.config['query'];
  const query =
    cleanUrl && typeof pinnedQuery === 'object' && pinnedQuery !== null
      ? analyticsQuerySchema.parse(pinnedQuery)
      : requestedQuery;
  const initialInsight =
    cleanUrl && query.lens === 'insights'
      ? insightConfigSchema.parse(pinned?.config['insight'] ?? {})
      : insightConfigFromSearchParams(params);
  const hydrationState =
    query.lens === 'insights'
      ? await dehydratedAnalyticsInsights(
          principal,
          analyticsInsightsQuerySchema.parse({ ...query, insight: initialInsight }),
        )
      : await dehydratedAnalyticsLens(principal, query);

  return (
    <HydrationBoundary state={hydrationState}>
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <AnalyticsCockpit
          canManageAllViews={principal.role === 'admin'}
          canManageViews={can(principal, 'view:manage')}
          currentUserId={principal.userId}
          initialInsight={initialInsight}
          initialQuery={query}
          savedViews={savedViews}
        />
      </div>
    </HydrationBoundary>
  );
}
