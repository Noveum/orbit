'use client';

import type { SavedAnalyticsViewPayload } from '@orbit/core';
import {
  ANALYTICS_LENSES,
  type AnalyticsLens,
  type AnalyticsQuery,
  analyticsQuerySchema,
} from '@orbit/shared/validators';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { AnalyticsTabs } from './analytics-tabs.tsx';
import { AnalyticsToolbar } from './analytics-toolbar.tsx';
import type { AnalyticsResponseByLens } from './contracts.ts';
import { OverviewLens } from './overview-lens.tsx';
import { PeopleLens } from './people-lens.tsx';
import { ProjectsLens } from './projects-lens.tsx';
import { searchParamsForAnalytics } from './query-state.ts';
import { SavedViewBar } from './saved-view-bar.tsx';
import { SprintLens } from './sprint-lens.tsx';
import { useAnalyticsQuery } from './use-analytics-query.ts';

const defaultQuery = analyticsQuerySchema.parse({});

function writeUrl(query: AnalyticsQuery) {
  const search = searchParamsForAnalytics(query).toString();
  const path = typeof window === 'undefined' ? '/analytics' : window.location.pathname;
  window.history.replaceState(null, '', search.length === 0 ? path : `${path}?${search}`);
}

function LensContent({
  data,
  query,
  onFocusProject,
  onFocusPerson,
}: {
  readonly data: AnalyticsResponseByLens[AnalyticsLens];
  readonly query: AnalyticsQuery;
  readonly onFocusProject: (projectId: string) => void;
  readonly onFocusPerson: (personId: string) => void;
}) {
  switch (data.lens) {
    case 'overview':
      return <OverviewLens data={data} query={query} />;
    case 'sprints':
      return <SprintLens data={data} query={query} />;
    case 'projects':
      return <ProjectsLens data={data} onFocusProject={onFocusProject} query={query} />;
    case 'people':
      return <PeopleLens data={data} onFocusPerson={onFocusPerson} query={query} />;
  }
}

export function AnalyticsCockpit({
  initialQuery,
  savedViews = [],
  canManageViews = false,
  canManageAllViews = false,
  currentUserId = null,
}: {
  readonly initialQuery: AnalyticsQuery;
  readonly savedViews?: readonly SavedAnalyticsViewPayload[];
  readonly canManageViews?: boolean;
  readonly canManageAllViews?: boolean;
  readonly currentUserId?: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const result = useAnalyticsQuery(query);
  const update = (patch: Partial<AnalyticsQuery>) => {
    const next = analyticsQuerySchema.parse({ ...query, ...patch });
    setQuery(next);
    writeUrl(next);
  };
  const reset = () => {
    setQuery(defaultQuery);
    writeUrl(defaultQuery);
  };
  let content: React.ReactNode;
  if (result.isError) {
    content = (
      <section className="rounded-lg border border-danger/30 bg-surface p-6">
        <h2 className="font-medium text-text">Analytics could not load</h2>
        <p className="mt-1 text-muted text-sm">Try again or reset the view.</p>
      </section>
    );
  } else if (result.data === undefined) {
    content = (
      <div
        aria-label="Loading analytics"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        role="status"
      >
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  } else {
    content = (
      <LensContent
        data={result.data}
        onFocusPerson={(personId) => update({ focus: { ...query.focus, personId } })}
        onFocusProject={(projectId) => update({ focus: { ...query.focus, projectId } })}
        query={query}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-semibold text-lg text-text">Analytics</h1>
            <p className="mt-1 text-muted text-xs">
              Plan scope, delivery, sprints, projects, and individual work from one shared source.
            </p>
          </div>
          <p className="text-faint text-2xs">
            {result.data === undefined
              ? 'Refreshing'
              : `Data through ${result.data.coverage.asOf.slice(0, 10)}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <AnalyticsTabs value={query.lens} onChange={(lens) => update({ lens })} />
        </div>
      </header>
      <div className="sticky top-0 z-20 rounded-lg border border-border bg-background/95 p-2 shadow-sm backdrop-blur">
        <AnalyticsToolbar query={query} onChange={update} onReset={reset} />
      </div>
      <SavedViewBar
        canManage={canManageViews}
        canManageAll={canManageAllViews}
        currentUserId={currentUserId}
        onApply={(saved) => update(saved)}
        query={query}
        views={savedViews}
      />
      {ANALYTICS_LENSES.map((lens) => (
        <div
          aria-labelledby={`analytics-tab-${lens}`}
          hidden={lens !== query.lens}
          id={`analytics-panel-${lens}`}
          key={lens}
          role="tabpanel"
        >
          {lens === query.lens ? content : null}
        </div>
      ))}
    </div>
  );
}
