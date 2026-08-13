'use client';

import type { FilterNode } from '@orbit/shared/filters';
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
import type {
  AnalyticsOverviewResponse,
  AnalyticsPeopleResponse,
  AnalyticsProjectsResponse,
  AnalyticsResponseByLens,
  AnalyticsSprintsResponse,
} from './contracts.ts';
import { searchParamsForAnalytics } from './query-state.ts';
import { useAnalyticsQuery } from './use-analytics-query.ts';

const defaultQuery = analyticsQuerySchema.parse({});

function writeUrl(query: AnalyticsQuery) {
  const search = searchParamsForAnalytics(query).toString();
  const path = typeof window === 'undefined' ? '/analytics' : window.location.pathname;
  window.history.replaceState(null, '', search.length === 0 ? path : `${path}?${search}`);
}

function valueLabel(value: number, unit: string): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit === 'days' ? `${formatted}d` : formatted;
}

function MetricStrip({
  metrics,
}: {
  readonly metrics: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly unit: string;
    readonly delta?: number | null;
  }>;
}) {
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">
      {metrics.map((metric) => (
        <article
          className="min-w-40 snap-start rounded-lg border border-border bg-surface p-4"
          key={metric.id}
        >
          <p className="text-muted text-xs">{metric.label}</p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="font-semibold text-2xl text-text">
              {valueLabel(metric.value, metric.unit)}
            </p>
            {metric.delta === undefined || metric.delta === null ? null : (
              <span className="text-faint text-xs">
                {metric.delta > 0 ? '+' : ''}
                {valueLabel(metric.delta, metric.unit)}
              </span>
            )}
          </div>
          <p className="mt-1 text-faint text-2xs uppercase">{metric.unit}</p>
        </article>
      ))}
    </div>
  );
}

function OverviewContent({ data }: { readonly data: AnalyticsOverviewResponse }) {
  const delivery = data.delivery.reduce(
    (total, bucket) => ({
      created: total.created + bucket.created,
      completed: total.completed + bucket.completed,
      open: bucket.open,
    }),
    { created: 0, completed: 0, open: 0 },
  );
  return (
    <div className="grid gap-4">
      <MetricStrip
        metrics={data.cards.map((card) => ({
          id: card.id,
          label: card.label,
          value: card.value,
          unit: card.unit,
          delta: card.comparisonDelta,
        }))}
      />
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium text-sm text-text">Planning pulse</h2>
            <p className="mt-1 text-muted text-xs">
              Created, completed, and open work across the selected period.
            </p>
          </div>
          <span className="rounded-full bg-surface-2 px-2 py-1 text-faint text-2xs uppercase">
            {data.coverage.kind}
          </span>
        </div>
        {data.delivery.length === 0 ? (
          <p className="py-12 text-center text-muted text-sm">
            Delivery activity will appear as work moves.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="font-semibold text-text" data-testid="delivery-created">
                {delivery.created}
              </p>
              <p className="text-faint text-xs">Created</p>
            </div>
            <div>
              <p className="font-semibold text-text" data-testid="delivery-completed">
                {delivery.completed}
              </p>
              <p className="text-faint text-xs">Completed</p>
            </div>
            <div>
              <p className="font-semibold text-text" data-testid="delivery-open">
                {delivery.open}
              </p>
              <p className="text-faint text-xs">Open</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SprintsContent({ data }: { readonly data: AnalyticsSprintsResponse }) {
  if (data.current === null || data.selected === null) {
    return (
      <section className="rounded-lg border border-border bg-surface px-6 py-14 text-center">
        <h2 className="font-medium text-base text-text">No sprint history yet</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted text-sm">
          Start a sprint and its burn and comparison charts will appear here as work is added,
          completed, removed, or carried over.
        </p>
      </section>
    );
  }
  const summary = data.current.summary;
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-muted text-xs">Current sprint</p>
        <h2 className="mt-1 font-medium text-base text-text">{data.selected.name}</h2>
      </div>
      <MetricStrip
        metrics={[
          { id: 'planned', label: 'Planned', value: summary.planned, unit: data.current.measure },
          {
            id: 'completed',
            label: 'Completed',
            value: summary.completed,
            unit: data.current.measure,
          },
          {
            id: 'remaining',
            label: 'Remaining',
            value: summary.remaining,
            unit: data.current.measure,
          },
          {
            id: 'carryover',
            label: 'Carryover',
            value: summary.carryover,
            unit: data.current.measure,
          },
        ]}
      />
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-medium text-sm text-text">Sprint burn</h3>
        <p className="mt-1 text-muted text-xs">
          Remaining scope updates from issue completion and membership changes.
        </p>
        <div aria-label="Sprint burn preview" className="mt-4 flex h-28 items-end gap-1" role="img">
          {data.current.burn.map((point) => {
            const denominator = Math.max(summary.currentScope, 1);
            return (
              <div
                className="min-w-1 flex-1 rounded-t-sm bg-accent/70"
                key={point.date}
                style={{ height: `${Math.max(3, (point.remaining / denominator) * 100)}%` }}
                title={`${point.date}: ${point.remaining} remaining`}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ProjectsContent({
  data,
  query,
}: {
  readonly data: AnalyticsProjectsResponse;
  readonly query: AnalyticsQuery;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-border border-b px-4 py-3">
        <h2 className="font-medium text-sm text-text">Project portfolio</h2>
        <p className="mt-1 text-muted text-xs">Scope, progress, health, and delivery risk.</p>
      </div>
      {data.projects.length === 0 ? (
        <p className="p-10 text-center text-muted text-sm">No projects match this view.</p>
      ) : (
        <div className="divide-y divide-border">
          {data.projects.slice(0, 10).map((project) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3"
              key={project.id}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-sm text-text">{project.name}</p>
                <p className="text-faint text-xs">
                  {project.status} · {project.health}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-text text-xs">
                  {query.measure === 'points' ? project.completedPoints : project.completedIssues}/
                  {query.measure === 'points' ? project.scopePoints : project.scopeIssues}
                </p>
                <p className="text-faint text-2xs">completed</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-text text-xs">{project.blocked}</p>
                <p className="text-faint text-2xs">blocked</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PeopleContent({
  data,
  query,
}: {
  readonly data: AnalyticsPeopleResponse;
  readonly query: AnalyticsQuery;
}) {
  const focused = data.focused;
  const points = query.measure === 'points';
  const selectedByFilter = selectedAssignees(query.filter).length === 1;
  return (
    <div className="grid gap-4">
      {focused === null ? null : (
        <section className="rounded-lg border border-accent/40 bg-surface p-4">
          <p className="text-accent text-xs">
            {query.focus.personId === undefined && !selectedByFilter
              ? 'My work'
              : 'Selected person'}
          </p>
          <h2 className="mt-1 font-medium text-base text-text">{focused.person.name}</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="font-semibold text-xl text-text">
                {points ? focused.currentPoints : focused.currentAssignments}
              </p>
              <p className="text-faint text-xs">Assigned now</p>
            </div>
            <div>
              <p className="font-semibold text-xl text-text">
                {points ? focused.completedPoints : focused.completedIssues}
              </p>
              <p className="text-faint text-xs">Completed</p>
            </div>
            <div>
              <p className="font-semibold text-xl text-text">
                {(points
                  ? focused.averageThroughputPoints
                  : focused.averageThroughputIssues
                ).toFixed(1)}
              </p>
              <p className="text-faint text-xs">Avg per active week</p>
            </div>
            <div>
              <p className="font-semibold text-xl text-text">
                {points ? focused.currentWipPoints : focused.currentWip}
              </p>
              <p className="text-faint text-xs">Work in progress</p>
            </div>
          </div>
        </section>
      )}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-border border-b px-4 py-3">
          <h2 className="font-medium text-sm text-text">People</h2>
          <p className="mt-1 text-muted text-xs">
            Workspace workload and delivery, sorted alphabetically.
          </p>
        </div>
        <div className="divide-y divide-border">
          {data.people.slice(0, 12).map((person) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3"
              key={person.person.id}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-sm text-text">{person.person.name}</p>
                <p className="text-faint text-xs">{person.person.status}</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-text text-xs">
                  {points ? person.currentPoints : person.currentAssignments}
                </p>
                <p className="text-faint text-2xs">assigned</p>
              </div>
              <div className="text-right">
                <p className="font-medium text-text text-xs">
                  {points ? person.completedPoints : person.completedIssues}
                </p>
                <p className="text-faint text-2xs">completed</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function constrainedAssignees(node: FilterNode): ReadonlySet<string> | null {
  if (node.kind === 'condition') {
    if (node.property !== 'assignee' || node.operator !== 'in' || node.negate) return null;
    return new Set(node.values);
  }
  const sets = node.children.map(constrainedAssignees);
  if (node.combinator === 'or') {
    if (sets.some((set) => set === null)) return null;
    return new Set(sets.flatMap((set) => (set === null ? [] : [...set])));
  }
  const known = sets.filter((set): set is ReadonlySet<string> => set !== null);
  if (known.length === 0) return null;
  const values = new Set(known[0]);
  for (const set of known.slice(1)) {
    for (const value of values) {
      if (!set.has(value)) values.delete(value);
    }
  }
  return values;
}

function selectedAssignees(filter: AnalyticsQuery['filter']): readonly string[] {
  const selected = constrainedAssignees(filter);
  return selected === null ? [] : [...selected];
}

function LensContent({
  data,
  query,
}: {
  readonly data: AnalyticsResponseByLens[AnalyticsLens];
  readonly query: AnalyticsQuery;
}) {
  switch (data.lens) {
    case 'overview':
      return <OverviewContent data={data} />;
    case 'sprints':
      return <SprintsContent data={data} />;
    case 'projects':
      return <ProjectsContent data={data} query={query} />;
    case 'people':
      return <PeopleContent data={data} query={query} />;
  }
}

export function AnalyticsCockpit({ initialQuery }: { readonly initialQuery: AnalyticsQuery }) {
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
    content = <LensContent data={result.data} query={query} />;
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
