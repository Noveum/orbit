'use client';

import type { AnalyticsLens, AnalyticsQuery } from '@orbit/shared/validators';
import { useAnalyticsQuery } from './use-analytics-query.ts';

const LENS_LABELS: Record<AnalyticsLens, string> = {
  overview: 'Overview',
  sprints: 'Sprints',
  projects: 'Projects',
  people: 'People',
};

export function AnalyticsCockpitDataBoundary({ query }: { readonly query: AnalyticsQuery }) {
  const result = useAnalyticsQuery(query);
  let message = 'Analytics data is ready.';
  if (result.isError) message = 'Analytics data is unavailable.';
  else if (result.data === undefined) message = 'Loading analytics data.';

  return (
    <section
      aria-label={`${LENS_LABELS[query.lens]} analytics`}
      className="rounded-lg border border-border bg-surface p-6"
    >
      <p className="text-muted text-sm" role="status">
        {message}
      </p>
    </section>
  );
}
