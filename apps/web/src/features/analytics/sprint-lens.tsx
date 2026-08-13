'use client';

import type { AnalyticsQuery } from '@orbit/shared/validators';
import { useState } from 'react';
import { AnalyticsCard } from './analytics-card.tsx';
import { BarPlot } from './charts/bar-plot.tsx';
import { LinePlot } from './charts/line-plot.tsx';
import type { AnalyticsSprintsResponse } from './contracts.ts';

type BurnMode = 'down' | 'up';

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function days(value: number): string {
  return `${numberLabel(value)}d`;
}

export function SprintLens({
  data,
  query,
}: {
  readonly data: AnalyticsSprintsResponse;
  readonly query: AnalyticsQuery;
}) {
  const [burnMode, setBurnMode] = useState<BurnMode>('down');
  const current = data.current;
  if (current === null || data.selected === null) {
    return (
      <section className="rounded-lg border border-border bg-surface px-6 py-14 text-center">
        <h2 className="font-medium text-base text-text">No sprint history yet</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted text-sm">
          Start a sprint and its burn and comparison charts will appear here as scope changes.
        </p>
      </section>
    );
  }

  const burnSeries =
    burnMode === 'down'
      ? [
          {
            id: 'remaining',
            label: 'Remaining',
            points: current.burn.map((point) => ({
              id: `${point.date}-remaining`,
              label: point.date,
              value: point.remaining,
              cohort: { cohort: 'open' as const },
            })),
          },
          {
            id: 'ideal',
            label: 'Ideal',
            points: current.burn.map((point) => ({
              id: `${point.date}-ideal`,
              label: point.date,
              value: point.ideal,
              cohort: { cohort: 'open' as const },
            })),
          },
          ...(data.previous === null
            ? []
            : [
                {
                  id: 'previous',
                  label: 'Previous remaining',
                  points: data.previous.burn.map((point) => ({
                    id: `${point.date}-previous`,
                    label: `Previous day ${point.calendarDay}`,
                    value: point.remaining,
                    cohort: { cohort: 'open' as const },
                  })),
                },
              ]),
        ]
      : [
          {
            id: 'completed',
            label: 'Completed',
            points: current.burn.map((point) => ({
              id: `${point.date}-completed`,
              label: point.date,
              value: point.completed,
              cohort: { cohort: 'completed' as const },
            })),
          },
          {
            id: 'scope',
            label: 'Scope',
            points: current.burn.map((point) => ({
              id: `${point.date}-scope`,
              label: point.date,
              value: point.scope,
              cohort: { cohort: 'open' as const },
            })),
          },
        ];
  const velocity = data.velocity.map((point) => ({
    id: point.sprint.id,
    label: point.sprint.name,
    value: point.completed,
    cohort: { cohort: 'completed' as const },
  }));
  const summary = current.summary;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted text-xs">Selected sprint</p>
          <h2 className="mt-1 font-medium text-base text-text">{data.selected.name}</h2>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-1 text-faint text-2xs uppercase">
          {current.coverage.kind}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Planned', summary.planned],
          ['Completed', summary.completed],
          ['Remaining', summary.remaining],
          ['Carryover', summary.carryover],
        ].map(([label, value]) => (
          <article className="rounded-lg border border-border bg-surface p-4" key={String(label)}>
            <p className="text-muted text-xs">{label}</p>
            <p className="mt-2 font-semibold text-2xl text-text tabular">
              {numberLabel(Number(value))}
            </p>
            <p className="mt-1 text-faint text-2xs uppercase">{current.measure}</p>
          </article>
        ))}
      </div>

      {query.measure === 'points' && summary.unestimated > 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-muted text-xs">
          {summary.unestimated} unestimated issues contribute zero points.
        </p>
      ) : null}

      <AnalyticsCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-sm text-text">Sprint burn</h3>
            <p className="mt-1 text-muted text-xs">
              Today combines captured history with live completions and scope changes.
            </p>
          </div>
          <fieldset className="inline-flex rounded-md border border-border p-0.5">
            <legend className="sr-only">Burn chart</legend>
            <button
              aria-pressed={burnMode === 'down'}
              className="rounded px-2 py-1 text-xs aria-pressed:bg-accent aria-pressed:text-on-accent"
              onClick={() => setBurnMode('down')}
              type="button"
            >
              Burn down
            </button>
            <button
              aria-pressed={burnMode === 'up'}
              className="rounded px-2 py-1 text-xs aria-pressed:bg-accent aria-pressed:text-on-accent"
              onClick={() => setBurnMode('up')}
              type="button"
            >
              Burn up
            </button>
          </fieldset>
        </div>
        <LinePlot
          label={burnMode === 'down' ? 'Sprint burn down' : 'Sprint burn up'}
          series={burnSeries}
        />
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="text-muted">
            Added <strong className="text-text">{numberLabel(summary.added)}</strong>
          </span>
          <span className="text-muted">
            Removed <strong className="text-text">{numberLabel(summary.removed)}</strong>
          </span>
          <span className="text-muted">
            Current scope <strong className="text-text">{numberLabel(summary.currentScope)}</strong>
          </span>
        </div>
      </AnalyticsCard>

      {data.previous === null ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-muted text-xs">
          A comparison will appear after this sprint closes.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsCard title="Flow time">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-muted text-xs">Lead time p50</dt>
              <dd className="mt-1 font-semibold text-xl text-text">
                {days(current.flow.leadTime.p50)}
              </dd>
              <p className="mt-1 text-faint text-xs">{data.formulas.leadTime}</p>
            </div>
            <div>
              <dt className="text-muted text-xs">Cycle time p50</dt>
              <dd className="mt-1 font-semibold text-xl text-text">
                {days(current.flow.cycleTime.p50)}
              </dd>
              <p className="mt-1 text-faint text-xs">{data.formulas.cycleTime}</p>
            </div>
          </dl>
          <p className="text-faint text-xs">{data.formulas.coverage}</p>
        </AnalyticsCard>

        <AnalyticsCard title="Velocity across sprints">
          {velocity.length === 0 ? (
            <p className="py-8 text-center text-muted text-xs">
              Velocity appears after a sprint closes.
            </p>
          ) : (
            <BarPlot label="Completed scope" points={velocity} />
          )}
        </AnalyticsCard>
      </div>

      {data.focus === null ? null : (
        <AnalyticsCard>
          <div>
            <p className="text-accent text-xs">
              {query.focus.personId === undefined
                ? 'My sprint burn'
                : 'Selected person sprint burn'}
            </p>
            <h3 className="mt-1 font-medium text-sm text-text">{data.focus.name}</h3>
            <p className="mt-1 text-muted text-xs">
              Work assigned to you over this sprint, using historical assignment facts where
              available.
            </p>
          </div>
          <LinePlot
            label={`${data.focus.name} remaining work`}
            series={[
              {
                id: 'person-remaining',
                label: 'Remaining',
                points: data.focus.burn.map((point) => ({
                  id: `${point.date}-person-remaining`,
                  label: point.date,
                  value: point.remaining,
                  cohort: { cohort: 'open' },
                })),
              },
            ]}
          />
        </AnalyticsCard>
      )}
    </div>
  );
}
