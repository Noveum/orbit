import type { AnalyticsMeasure } from '@orbit/shared/validators';
import { actualPace, burnForecast, forecastDate, neededPace, readableDate } from './burn-math.ts';
import type { AnalyticsSprintsResponse } from './contracts.ts';

const DAY_MILLISECONDS = 86_400_000;

function numberLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function paceLabel(value: number): string {
  return `${value.toFixed(1)}/d`;
}

function unitLabel(measure: AnalyticsMeasure): string {
  return measure === 'points' ? 'pts' : 'issues';
}

function counterpartMeasure(measure: AnalyticsMeasure): AnalyticsMeasure {
  return measure === 'points' ? 'issues' : 'points';
}

function percentOf(value: number, scope: number): number {
  return Math.round((value / Math.max(1, scope)) * 100);
}

function daysBetweenUtc(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / DAY_MILLISECONDS);
}

function forecastColorClass(forecastDateValue: string | null, isLate: boolean): string {
  if (forecastDateValue === null) return 'text-text';
  return isLate ? 'text-warning' : 'text-accent';
}

export function SprintStats({
  current,
  measure,
}: {
  readonly current: NonNullable<AnalyticsSprintsResponse['current']>;
  readonly measure: AnalyticsMeasure;
}) {
  const summary = current.summary;
  const scope = summary.currentScope;
  const completedPercent = percentOf(summary.completed, scope);
  const lastObserved = current.burn.filter((point) => !point.future).at(-1);
  const started = lastObserved?.started ?? 0;
  const startedPercent = percentOf(started, scope);
  const needed = neededPace(summary.remaining, current.burn);
  const actual = actualPace(current.burn);
  const forecast = burnForecast(current.burn);
  const forecastDateValue =
    forecast === null ? null : forecastDate(current.burn, forecast.completionWorkingDay);
  const lastDay = current.burn.at(-1)?.date ?? null;
  const daysLate =
    forecastDateValue === null || lastDay === null ? 0 : daysBetweenUtc(lastDay, forecastDateValue);
  const isLate = daysLate > 0;
  const peopleCount = current.people.length;

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <span className="text-muted">
        Scope{' '}
        <strong className="font-medium text-text">
          {`${numberLabel(scope)} ${unitLabel(measure)} · ${numberLabel(current.counterpart.currentScope)} ${unitLabel(counterpartMeasure(measure))}`}
        </strong>
      </span>
      <span className="text-muted">
        Completed{' '}
        <strong className="font-medium text-text">
          {`${numberLabel(summary.completed)} (${completedPercent}%)`}
        </strong>
      </span>
      <span className="text-muted">
        Started{' '}
        <strong className="font-medium text-text">
          {`${numberLabel(started)} (${startedPercent}%)`}
        </strong>
      </span>
      <span className="text-muted">
        Remaining{' '}
        <strong className="font-medium text-text">{numberLabel(summary.remaining)}</strong>
      </span>
      <span className="text-muted">
        Churn{' '}
        <strong className="font-medium text-text">
          {`+${numberLabel(summary.added)} added · ${numberLabel(summary.removed)} removed`}
        </strong>
      </span>
      <span className="text-muted">
        Pace{' '}
        <strong className="font-medium text-text">
          {needed === null || actual === null
            ? 'Not enough data'
            : `needed ${paceLabel(needed)} · actual ${paceLabel(actual)}`}
        </strong>
      </span>
      <span className="text-muted">
        Forecast{' '}
        <strong className={`font-medium ${forecastColorClass(forecastDateValue, isLate)}`}>
          {forecastDateValue === null
            ? 'needs 3 working days'
            : `${readableDate(forecastDateValue)} · ${isLate ? `${daysLate} ${daysLate === 1 ? 'day' : 'days'} late` : 'on track'}`}
        </strong>
      </span>
      <span className="text-muted">
        People{' '}
        <strong className="font-medium text-text">
          {`${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`}
        </strong>
      </span>
    </div>
  );
}
