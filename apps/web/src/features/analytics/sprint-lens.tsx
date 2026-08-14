'use client';

import type { AnalyticsQuery } from '@orbit/shared/validators';
import { useState } from 'react';
import { AnalyticsCard } from './analytics-card.tsx';
import { BarPlot } from './charts/bar-plot.tsx';
import { LinePlot, type PlotPoint } from './charts/line-plot.tsx';
import type { AnalyticsSprintsResponse } from './contracts.ts';
import { usesCurrentPersonDefault } from './person-focus.ts';

type BurnMode = 'down' | 'up';

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function days(value: number): string {
  return `${numberLabel(value)}d`;
}

function readableDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function localDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addUtcDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function workingDayNumber(start: string, end: string): number {
  let day = start;
  let count = 0;
  while (day <= end) {
    const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    day = addUtcDays(day, 1);
  }
  return Math.max(1, count);
}

function burnForecast(
  burn: NonNullable<AnalyticsSprintsResponse['current']>['burn'],
): { readonly completionWorkingDay: number; readonly points: readonly PlotPoint[] } | null {
  const observed = burn.filter((point) => point.available && point.workingDay !== null);
  if (observed.length < 3) return null;
  const count = observed.length;
  const meanX = observed.reduce((sum, point) => sum + (point.workingDay ?? 0), 0) / count;
  const meanY = observed.reduce((sum, point) => sum + point.remaining, 0) / count;
  const covariance = observed.reduce(
    (sum, point) => sum + ((point.workingDay ?? 0) - meanX) * (point.remaining - meanY),
    0,
  );
  const variance = observed.reduce((sum, point) => sum + ((point.workingDay ?? 0) - meanX) ** 2, 0);
  if (variance === 0) return null;
  const slope = covariance / variance;
  if (slope >= 0) return null;
  const intercept = meanY - slope * meanX;
  const last = observed.at(-1);
  if (last === undefined || last.workingDay === null) return null;
  const completionWorkingDay = Math.max(last.workingDay, Math.ceil(-intercept / slope));
  return {
    completionWorkingDay,
    points: [
      {
        id: 'forecast-current',
        label: last.date,
        value: last.remaining,
        cohort: { cohort: 'open' },
        x: last.workingDay,
      },
      {
        id: 'forecast-completion',
        label: `Forecast day ${completionWorkingDay}`,
        value: 0,
        cohort: { cohort: 'open' },
        x: completionWorkingDay,
      },
    ],
  };
}

function burnWithWorkingX(burn: NonNullable<AnalyticsSprintsResponse['current']>['burn']) {
  let lastWorkingDay = 0;
  return burn.map((point) => {
    if (point.workingDay !== null) lastWorkingDay = point.workingDay;
    return { point, x: lastWorkingDay };
  });
}

function trackingAnnotation(
  burn: NonNullable<AnalyticsSprintsResponse['current']>['burn'],
  trackingStart: string | null,
): string | undefined {
  if (trackingStart === null) return 'No reliable burn history is available yet.';
  if (burn.some((point) => !point.available)) {
    const trendGuidance =
      burn.filter((point) => point.available).length < 2
        ? ' A second reliable day is needed before an actual trend line can be drawn.'
        : '';
    return `Tracking began ${readableDate(trackingStart)}. Earlier dates are not zero.${trendGuidance}`;
  }
  return undefined;
}

function SprintBurnChart({
  current,
  previous,
  measureFormatter,
}: {
  readonly current: NonNullable<AnalyticsSprintsResponse['current']>;
  readonly previous: AnalyticsSprintsResponse['previous'];
  readonly measureFormatter: (value: number) => string;
}) {
  const [burnMode, setBurnMode] = useState<BurnMode>('down');
  const currentBurn = burnWithWorkingX(current.burn);
  const availableBurn = currentBurn.filter(({ point }) => point.available);
  const trackingStart = availableBurn[0]?.point.date ?? null;
  const forecast = burnForecast(current.burn);
  const annotation = trackingAnnotation(current.burn, trackingStart);
  const sprintStart = localDate(current.sprint.startsAt, current.sprint.timezone);
  const sprintEnd = localDate(
    new Date(Date.parse(current.sprint.endsAt) - 1).toISOString(),
    current.sprint.timezone,
  );
  const sprintEndWorkingDay = workingDayNumber(sprintStart, sprintEnd);
  const idealPoints = currentBurn.map(({ point, x }) => ({
    id: `${point.date}-ideal`,
    label: point.date,
    value: point.ideal,
    cohort: { cohort: 'open' as const },
    x,
    available: point.available,
  }));
  const lastIdeal = idealPoints.filter((point) => point.available).at(-1);
  if (lastIdeal !== undefined && (lastIdeal.x ?? 0) < sprintEndWorkingDay) {
    idealPoints.push({
      id: 'sprint-end-ideal',
      label: sprintEnd,
      value: 0,
      cohort: { cohort: 'open' },
      x: sprintEndWorkingDay,
      available: true,
    });
  }
  const elapsedWorkingDay = currentBurn.at(-1)?.x ?? 0;
  const previousBurn =
    previous === null
      ? []
      : burnWithWorkingX(previous.burn).filter(
          ({ point, x }) => point.workingDay !== null && x <= elapsedWorkingDay,
        );
  const burnSeries =
    burnMode === 'down'
      ? [
          {
            id: 'remaining',
            label: 'Remaining',
            points: currentBurn.map(({ point, x }) => ({
              id: `${point.date}-remaining`,
              label: point.date,
              value: point.remaining,
              cohort: { cohort: 'open' as const },
              x,
              available: point.available,
            })),
          },
          {
            id: 'scope',
            label: 'Scope',
            dashed: true,
            points: currentBurn.map(({ point, x }) => ({
              id: `${point.date}-scope`,
              label: point.date,
              value: point.scope,
              cohort: { cohort: 'open' as const },
              x,
              available: point.available,
            })),
          },
          {
            id: 'ideal',
            label: 'Ideal',
            dashed: true,
            points: idealPoints,
          },
          ...(forecast === null
            ? []
            : [
                {
                  id: 'forecast',
                  label: 'Forecast',
                  dashed: true,
                  points: forecast.points,
                },
              ]),
          ...(previous === null
            ? []
            : [
                {
                  id: 'previous',
                  label: 'Previous remaining',
                  points: previousBurn.map(({ point, x }) => ({
                    id: `${point.date}-previous`,
                    label: `Previous day ${point.calendarDay}`,
                    value: point.remaining,
                    cohort: { cohort: 'open' as const },
                    x,
                    available: point.available,
                  })),
                },
              ]),
        ]
      : [
          {
            id: 'completed',
            label: 'Completed',
            points: currentBurn.map(({ point, x }) => ({
              id: `${point.date}-completed`,
              label: point.date,
              value: point.completed,
              cohort: { cohort: 'completed' as const },
              x,
              available: point.available,
            })),
          },
          {
            id: 'scope',
            label: 'Scope',
            points: currentBurn.map(({ point, x }) => ({
              id: `${point.date}-scope`,
              label: point.date,
              value: point.scope,
              cohort: { cohort: 'open' as const },
              x,
              available: point.available,
            })),
          },
        ];

  return (
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
        {...(annotation === undefined ? {} : { annotation })}
        label={burnMode === 'down' ? 'Sprint burn down' : 'Sprint burn up'}
        series={burnSeries}
        valueFormatter={measureFormatter}
        xAxisLabel="Sprint working day"
        yAxisLabel={`${burnMode === 'down' ? 'Remaining' : 'Completed'} ${current.measure}`}
      />
      <p className="text-muted text-xs">
        {forecast === null
          ? 'Forecast needs at least 3 working days with a declining remaining-work trend.'
          : `Current trend forecasts completion around working day ${forecast.completionWorkingDay}.`}
      </p>
      {trackingStart !== null && current.burn.some((point) => !point.available) ? (
        <p className="text-faint text-xs">
          The ideal line starts at the first reliable scope baseline and reaches zero at sprint end.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="text-muted">
          Added <strong className="text-text">{numberLabel(current.summary.added)}</strong>
        </span>
        <span className="text-muted">
          Removed <strong className="text-text">{numberLabel(current.summary.removed)}</strong>
        </span>
        <span className="text-muted">
          Current scope{' '}
          <strong className="text-text">{numberLabel(current.summary.currentScope)}</strong>
        </span>
      </div>
      <p className="text-faint text-xs">Initial scope capture is a baseline, not added work.</p>
    </AnalyticsCard>
  );
}

export function SprintLens({
  data,
  query,
}: {
  readonly data: AnalyticsSprintsResponse;
  readonly query: AnalyticsQuery;
}) {
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
  const velocity = data.velocity.map((point) => ({
    id: point.sprint.id,
    label: point.sprint.name,
    value: point.completed,
    cohort: { cohort: 'completed' as const },
  }));
  const summary = current.summary;
  const measureFormatter = (value: number) => `${numberLabel(value)} ${current.measure}`;
  const currentPerson = usesCurrentPersonDefault(query);

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

      <SprintBurnChart
        current={current}
        measureFormatter={measureFormatter}
        previous={data.previous}
      />

      {data.previous === null ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-muted text-xs">
          {data.selected.completedAt === null
            ? 'A comparison will appear after this sprint closes.'
            : 'No earlier sprint is available for comparison.'}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsCard title="Flow time">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-muted text-xs">Lead time p50</dt>
              <dd className="mt-1 font-semibold text-xl text-text">
                {current.flow.leadTime.count === 0
                  ? 'Not available'
                  : days(current.flow.leadTime.p50)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Lead time p85</dt>
              <dd className="mt-1 font-semibold text-xl text-text">
                {current.flow.leadTime.count === 0
                  ? 'Not available'
                  : days(current.flow.leadTime.p85)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Cycle time p50</dt>
              <dd className="mt-1 font-semibold text-xl text-text">
                {current.flow.cycleTime.count === 0
                  ? 'Not available'
                  : days(current.flow.cycleTime.p50)}
              </dd>
            </div>
            <div>
              <dt className="text-muted text-xs">Cycle time p85</dt>
              <dd className="mt-1 font-semibold text-xl text-text">
                {current.flow.cycleTime.count === 0
                  ? 'Not available'
                  : days(current.flow.cycleTime.p85)}
              </dd>
            </div>
          </dl>
          <p className="text-faint text-xs">{data.formulas.leadTime}</p>
          <p className="text-faint text-xs">{data.formulas.cycleTime}</p>
          <p className="text-faint text-xs">
            Lead coverage: {current.flow.leadTimeCoverage}. Cycle coverage:{' '}
            {current.flow.cycleTimeCoverage}.
          </p>
          <p className="text-faint text-xs">{data.formulas.coverage}</p>
        </AnalyticsCard>

        <AnalyticsCard title="Velocity across sprints">
          {velocity.length === 0 ? (
            <p className="py-8 text-center text-muted text-xs">
              Velocity appears after a sprint closes.
            </p>
          ) : (
            <BarPlot
              label="Completed scope"
              points={velocity}
              valueFormatter={measureFormatter}
              xAxisLabel={`Completed ${current.measure}`}
            />
          )}
        </AnalyticsCard>
      </div>

      {data.focus === null ? null : (
        <AnalyticsCard>
          <div>
            <p className="text-accent text-xs">
              {currentPerson ? 'My sprint burn' : 'Selected person sprint burn'}
            </p>
            <h3 className="mt-1 font-medium text-sm text-text">{data.focus.name}</h3>
            <p className="mt-1 text-muted text-xs">
              Work assigned to {currentPerson ? 'you' : data.focus.name} over this sprint, using
              historical assignment facts where available.
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
                  x: point.workingDay ?? point.calendarDay,
                  available: point.available,
                })),
              },
            ]}
            valueFormatter={measureFormatter}
            xAxisLabel="Sprint working day"
            yAxisLabel={`Remaining ${current.measure}`}
          />
        </AnalyticsCard>
      )}
    </div>
  );
}
