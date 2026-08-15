'use client';

import type { SavedAnalyticsViewPayload } from '@orbit/core';
import {
  ANALYTICS_LENSES,
  type AnalyticsQuery,
  analyticsInsightsQuerySchema,
  analyticsQuerySchema,
  type InsightConfig,
  insightConfigSchema,
} from '@orbit/shared/validators';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { AnalyticsTabs } from './analytics-tabs.tsx';
import { AnalyticsToolbar } from './analytics-toolbar.tsx';
import type { AnalyticsResponseByLens } from './contracts.ts';
import { InsightsLens } from './insights-lens.tsx';
import { OverviewLens } from './overview-lens.tsx';
import { PeopleLens } from './people-lens.tsx';
import { ProjectsLens } from './projects-lens.tsx';
import { searchParamsForSavedAnalyticsView } from './query-state.ts';
import { SavedViewBar } from './saved-view-bar.tsx';
import { SprintLens } from './sprint-lens.tsx';
import { useAnalyticsQuery, useInsightsQuery } from './use-analytics-query.ts';

const defaultQuery = analyticsQuerySchema.parse({});
const defaultInsightConfig = insightConfigSchema.parse({});

function writeUrl(query: AnalyticsQuery, insight: InsightConfig) {
  const search = searchParamsForSavedAnalyticsView(query, insight).toString();
  const path = typeof window === 'undefined' ? '/analytics' : window.location.pathname;
  window.history.replaceState(null, '', search.length === 0 ? path : `${path}?${search}`);
}

function AnalyticsErrorCard() {
  return (
    <section className="rounded-lg border border-danger/30 bg-surface p-6">
      <h2 className="font-medium text-text">Analytics could not load</h2>
      <p className="mt-1 text-muted text-sm">Try again or reset the view.</p>
    </section>
  );
}

function AnalyticsLoadingGrid() {
  return (
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
}

function LensContent({
  data,
  query,
  onFocusProject,
  onFocusPerson,
}: {
  readonly data: AnalyticsResponseByLens[keyof AnalyticsResponseByLens];
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

function headerCaptionFor(
  query: AnalyticsQuery,
  result: ReturnType<typeof useAnalyticsQuery>,
  insightsResult: ReturnType<typeof useInsightsQuery>,
): string {
  if (query.lens === 'insights') {
    if (insightsResult.isError) return 'Analytics could not load';
    return insightsResult.data === undefined ? 'Refreshing' : 'Insights are computed on demand';
  }
  if (result.isError) return 'Analytics could not load';
  if (result.data === undefined) return 'Refreshing';
  return `Data through ${result.data.coverage.asOf.slice(0, 10)}`;
}

function insightForAppliedView(
  nextQuery: AnalyticsQuery,
  nextInsight: InsightConfig | undefined,
  currentInsight: InsightConfig,
): InsightConfig {
  if (nextInsight !== undefined) return insightConfigSchema.parse(nextInsight);
  return nextQuery.lens === 'insights' ? defaultInsightConfig : currentInsight;
}

function insightsContent(
  insightsResult: ReturnType<typeof useInsightsQuery>,
  query: AnalyticsQuery,
  insight: InsightConfig,
  onInsightChange: (next: InsightConfig) => void,
): React.ReactNode {
  if (insightsResult.isError) return <AnalyticsErrorCard />;
  if (insightsResult.data === undefined) return <AnalyticsLoadingGrid />;
  return (
    <InsightsLens
      data={insightsResult.data}
      insight={insight}
      onInsightChange={onInsightChange}
      query={query}
    />
  );
}

export function AnalyticsCockpit({
  initialQuery,
  initialInsight = defaultInsightConfig,
  savedViews = [],
  canManageViews = false,
  canManageAllViews = false,
  currentUserId = null,
}: {
  readonly initialQuery: AnalyticsQuery;
  readonly initialInsight?: InsightConfig;
  readonly savedViews?: readonly SavedAnalyticsViewPayload[];
  readonly canManageViews?: boolean;
  readonly canManageAllViews?: boolean;
  readonly currentUserId?: string | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [insight, setInsight] = useState(initialInsight);
  const result = useAnalyticsQuery(query);
  const insightsResult = useInsightsQuery(
    analyticsInsightsQuerySchema.parse({ ...query, insight }),
    {
      enabled: query.lens === 'insights',
    },
  );
  const update = (patch: Partial<AnalyticsQuery>) => {
    const next = analyticsQuerySchema.parse({ ...query, ...patch });
    setQuery(next);
    writeUrl(next, insight);
  };
  const updateInsight = (next: InsightConfig) => {
    const parsed = insightConfigSchema.parse(next);
    setInsight(parsed);
    writeUrl(query, parsed);
  };
  const applySavedView = (nextQuery: AnalyticsQuery, nextInsight?: InsightConfig) => {
    const parsedInsight = insightForAppliedView(nextQuery, nextInsight, insight);
    setQuery(nextQuery);
    setInsight(parsedInsight);
    writeUrl(nextQuery, parsedInsight);
  };
  const reset = () => {
    setQuery(defaultQuery);
    setInsight(defaultInsightConfig);
    writeUrl(defaultQuery, defaultInsightConfig);
  };
  let content: React.ReactNode;
  if (query.lens === 'insights') {
    content = insightsContent(insightsResult, query, insight, updateInsight);
  } else if (result.isError) {
    content = <AnalyticsErrorCard />;
  } else if (result.data === undefined) {
    content = <AnalyticsLoadingGrid />;
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
  const headerCaption = headerCaptionFor(query, result, insightsResult);

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
          <p className="text-faint text-2xs">{headerCaption}</p>
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
        insight={insight}
        onApply={applySavedView}
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
