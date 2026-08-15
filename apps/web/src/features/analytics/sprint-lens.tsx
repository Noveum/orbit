'use client';

import type { AnalyticsQuery } from '@orbit/shared/validators';
import { useState } from 'react';
import { AnalyticsCard } from './analytics-card.tsx';
import {
  burnForecast,
  forecastDate,
  personCaptureCaption,
  personIdealSeries,
  readableDate,
  type SprintDay,
  sprintDays,
  todayDateOf,
  unestimatedNote,
} from './burn-math.ts';
import type { BarPair, BarPlotAverageLine } from './charts/bar-plot.tsx';
import { BarPlot } from './charts/bar-plot.tsx';
import type { PlotPoint, PlotSeries } from './charts/line-plot.tsx';
import { LinePlot } from './charts/line-plot.tsx';
import type { AnalyticsSprintsResponse } from './contracts.ts';
import { usesCurrentPersonDefault } from './person-focus.ts';
import { SprintStats } from './sprint-stats.tsx';

type BurnMode = 'down' | 'up';
type SprintCurrent = NonNullable<AnalyticsSprintsResponse['current']>;
type SprintBurnPoints = SprintCurrent['burn'];

const DAY_MILLISECONDS = 86_400_000;

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function days(value: number): string {
  return `${numberLabel(value)}d`;
}

function capturedPoints(burn: SprintBurnPoints): SprintBurnPoints {
  return burn.filter((point) => point.available && !point.future);
}

function initialScopeOf(current: SprintCurrent): number {
  const firstAvailable = current.burn.find((point) => point.available);
  return current.baseline?.scope ?? firstAvailable?.scope ?? 0;
}

function idealSeries(burn: SprintBurnPoints): PlotSeries {
  return {
    id: 'ideal',
    label: 'Ideal',
    color: 2,
    dashed: true,
    dots: true,
    points: burn.map((point) => ({
      id: `${point.date}-ideal`,
      label: point.date,
      value: point.ideal,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function remainingSeries(burn: SprintBurnPoints): PlotSeries {
  return {
    id: 'remaining',
    label: 'Remaining',
    color: 1,
    points: capturedPoints(burn).map((point) => ({
      id: `${point.date}-remaining`,
      label: point.date,
      value: point.remaining,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function focusRemainingSeries(burn: SprintBurnPoints): PlotSeries {
  return {
    id: 'person-remaining',
    label: 'Remaining',
    color: 1,
    points: capturedPoints(burn).map((point) => ({
      id: `${point.date}-person-remaining`,
      label: point.date,
      value: point.remaining,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function scopeSeries(
  burn: SprintBurnPoints,
  options: { readonly step?: boolean } = {},
): PlotSeries {
  return {
    id: 'scope',
    label: 'Scope',
    color: 4,
    ...(options.step === true ? { step: true } : {}),
    points: capturedPoints(burn).map((point) => ({
      id: `${point.date}-scope`,
      label: point.date,
      value: point.scope,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function completedSeries(burn: SprintBurnPoints): PlotSeries {
  return {
    id: 'completed',
    label: 'Completed',
    color: 1,
    points: capturedPoints(burn).map((point) => ({
      id: `${point.date}-completed`,
      label: point.date,
      value: point.completed,
      cohort: { cohort: 'completed' as const },
    })),
  };
}

function startedSeries(burn: SprintBurnPoints): PlotSeries {
  return {
    id: 'started',
    label: 'Started',
    color: 2,
    points: capturedPoints(burn).map((point) => ({
      id: `${point.date}-started`,
      label: point.date,
      value: point.completed + point.started,
      displayValue: point.started,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function targetSeries(burn: SprintBurnPoints, initialScope: number): PlotSeries {
  return {
    id: 'target',
    label: 'Target',
    color: 3,
    dashed: true,
    points: burn.map((point) => ({
      id: `${point.date}-target`,
      label: point.date,
      value: initialScope - point.ideal,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function daysBetweenDates(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MILLISECONDS,
  );
}

function forecastEndPoint(
  startLabel: string,
  startValue: number,
  targetDate: string,
  lastDayDate: string,
): { readonly label: string; readonly value: number } {
  if (targetDate <= lastDayDate) return { label: targetDate, value: 0 };
  const span = daysBetweenDates(startLabel, targetDate);
  const elapsed = daysBetweenDates(startLabel, lastDayDate);
  const fraction = span <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / span));
  return { label: lastDayDate, value: Math.max(0, startValue * (1 - fraction)) };
}

function forecastSeriesFor(
  forecast: ReturnType<typeof burnForecast>,
  forecastDateValue: string | null,
  sprintDaysList: readonly SprintDay[],
): PlotSeries | null {
  const start = forecast?.points[0];
  const lastDay = sprintDaysList.at(-1);
  if (
    forecast === null ||
    start === undefined ||
    forecastDateValue === null ||
    lastDay === undefined
  ) {
    return null;
  }
  const end = forecastEndPoint(start.label, start.value, forecastDateValue, lastDay.date);
  const points: PlotPoint[] = [
    {
      id: 'forecast-current',
      label: start.label,
      value: start.value,
      cohort: { cohort: 'open' as const },
    },
    {
      id: 'forecast-completion',
      label: end.label,
      value: end.value,
      cohort: { cohort: 'open' as const },
    },
  ];
  return { id: 'forecast', label: 'Forecast', color: 3, dashed: true, points };
}

function SprintBurnChart({
  current,
  measureFormatter,
}: {
  readonly current: SprintCurrent;
  readonly measureFormatter: (value: number) => string;
}) {
  const [burnMode, setBurnMode] = useState<BurnMode>('down');
  const sprintDaysList = sprintDays(current.burn, todayDateOf(current.burn));
  const forecast = burnForecast(current.burn);
  const forecastDateValue =
    forecast === null ? null : forecastDate(current.burn, forecast.completionWorkingDay);
  const captureAnnotation =
    current.baseline?.retroactive === true
      ? `Capture began ${readableDate(current.baseline.date)}. Earlier days show targets only.`
      : undefined;
  const forecastSeries = forecastSeriesFor(forecast, forecastDateValue, sprintDaysList);
  const burnSeries: readonly PlotSeries[] =
    burnMode === 'down'
      ? [
          remainingSeries(current.burn),
          idealSeries(current.burn),
          ...(forecastSeries === null ? [] : [forecastSeries]),
          scopeSeries(current.burn, { step: true }),
        ]
      : [
          completedSeries(current.burn),
          startedSeries(current.burn),
          scopeSeries(current.burn),
          targetSeries(current.burn, initialScopeOf(current)),
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
        {...(captureAnnotation === undefined ? {} : { annotation: captureAnnotation })}
        days={sprintDaysList}
        label={burnMode === 'down' ? 'Sprint burn down' : 'Sprint burn up'}
        series={burnSeries}
        valueFormatter={measureFormatter}
        xAxisLabel="Sprint day"
        yAxisLabel={`${burnMode === 'down' ? 'Remaining' : 'Completed'} ${current.measure}`}
      />
      <p className="text-muted text-xs">
        {forecast === null || forecastDateValue === null
          ? 'Forecast needs at least 3 working days with a declining remaining-work trend.'
          : `Current trend forecasts completion around ${readableDate(forecastDateValue)}.`}
      </p>
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

function FocusBurnCard({
  focus,
  currentPerson,
  measure,
  measureFormatter,
}: {
  readonly focus: NonNullable<AnalyticsSprintsResponse['focus']>;
  readonly currentPerson: boolean;
  readonly measure: string;
  readonly measureFormatter: (value: number) => string;
}) {
  const captureAnnotation = personCaptureCaption(focus.burn);
  return (
    <AnalyticsCard>
      <div>
        <p className="text-accent text-xs">
          {currentPerson ? 'My sprint burn' : 'Selected person sprint burn'}
        </p>
        <h3 className="mt-1 font-medium text-sm text-text">{focus.name}</h3>
        <p className="mt-1 text-muted text-xs">
          Work assigned to {currentPerson ? 'you' : focus.name} over this sprint, using historical
          assignment facts where available.
        </p>
      </div>
      <LinePlot
        {...(captureAnnotation === undefined ? {} : { annotation: captureAnnotation })}
        days={sprintDays(focus.burn, todayDateOf(focus.burn))}
        label={`${focus.name} remaining work`}
        series={[focusRemainingSeries(focus.burn), personIdealSeries(focus.burn)]}
        valueFormatter={measureFormatter}
        xAxisLabel="Sprint day"
        yAxisLabel={`Remaining ${measure}`}
      />
    </AnalyticsCard>
  );
}

type SprintVelocityPoint = AnalyticsSprintsResponse['velocity'][number];

function velocityPairPoints(idPrefix: string, planned: number, completed: number) {
  return {
    primary: {
      id: `${idPrefix}-completed`,
      label: 'Completed',
      value: completed,
      cohort: { cohort: 'completed' as const },
    },
    secondary: {
      id: `${idPrefix}-planned`,
      label: 'Planned',
      value: planned,
      cohort: { cohort: 'planned' as const },
    },
  };
}

function closedVelocityPairs(velocity: readonly SprintVelocityPoint[]): readonly BarPair[] {
  return velocity.map((point) => ({
    id: point.sprint.id,
    label: point.sprint.name,
    ...velocityPairPoints(point.sprint.id, point.planned, point.completed),
  }));
}

function currentVelocityPair(current: SprintCurrent): BarPair {
  return {
    id: 'current',
    label: current.sprint.name,
    current: true,
    ...velocityPairPoints('current', current.summary.planned, current.summary.completed),
  };
}

function velocityAverageLine(
  velocity: readonly SprintVelocityPoint[],
): BarPlotAverageLine | undefined {
  if (velocity.length === 0) return undefined;
  const mean = velocity.reduce((total, point) => total + point.completed, 0) / velocity.length;
  return { value: mean, label: `Avg ${numberLabel(mean)}` };
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
  const velocityPairs = [...closedVelocityPairs(data.velocity), currentVelocityPair(current)];
  const velocityAverage = velocityAverageLine(data.velocity);
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

      <SprintStats current={current} measure={current.measure} />

      {query.measure === 'points' && summary.unestimated > 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-muted text-xs">
          {unestimatedNote(summary.unestimated)}
        </p>
      ) : null}

      <SprintBurnChart current={current} measureFormatter={measureFormatter} />

      {data.previous === null ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-muted text-xs">
          {data.selected.completedAt === null
            ? 'Velocity below already includes this sprint as it happens.'
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
          <BarPlot
            {...(velocityAverage === undefined ? {} : { averageLine: velocityAverage })}
            label="Sprint velocity"
            pairs={velocityPairs}
            points={[]}
            valueFormatter={measureFormatter}
            xAxisLabel={current.measure === 'points' ? 'Points' : 'Issues'}
          />
          {data.velocity.length === 0 ? (
            <p className="text-muted text-xs">Velocity history builds as sprints complete.</p>
          ) : null}
        </AnalyticsCard>
      </div>

      {data.focus === null ? null : (
        <FocusBurnCard
          currentPerson={currentPerson}
          focus={data.focus}
          measure={current.measure}
          measureFormatter={measureFormatter}
        />
      )}
    </div>
  );
}
