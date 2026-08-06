import type { BurnUpPoint } from '@orbit/core';

export type BurnUpMetric = 'issues' | 'points';

export interface BurnUpSeries {
  readonly labels: string[];
  readonly completed: number[];
  readonly scope: number[];
  readonly ideal: number[];
  readonly max: number;
}

export interface BurnUpInput {
  readonly burnUp: readonly BurnUpPoint[];
  readonly scope: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly metric?: BurnUpMetric;
}

const DAY_MS = 86_400_000;

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function burnUpMetric(estimated: number): BurnUpMetric {
  return estimated > 0 ? 'points' : 'issues';
}

export function cycleDayCount(startsAt: Date, endsAt: Date): number {
  return Math.max(1, Math.round((utcDay(endsAt) - utcDay(startsAt)) / DAY_MS));
}

export function elapsedDayCount(startsAt: Date, endsAt: Date, lastDay: string | undefined): number {
  if (lastDay === undefined) return 0;
  const drawn = Date.parse(`${lastDay}T00:00:00.000Z`);
  if (Number.isNaN(drawn)) return 0;
  const elapsed = Math.round((drawn - utcDay(startsAt)) / DAY_MS);
  return Math.min(cycleDayCount(startsAt, endsAt), Math.max(0, elapsed));
}

export function idealLine(scope: number, totalDays: number, elapsedDays: number): number[] {
  const points: number[] = [];
  for (let day = 0; day <= elapsedDays; day += 1) {
    points.push((scope * day) / totalDays);
  }
  return points;
}

export function buildBurnUp(input: BurnUpInput): BurnUpSeries {
  const asPoints = input.metric === 'points';
  const completed = input.burnUp.map((point) =>
    asPoints ? point.completedPoints : point.completed,
  );
  const scope = input.burnUp.map((point) => (asPoints ? point.scopePoints : point.scope));
  const lastDay = input.burnUp.at(-1)?.date;
  return {
    labels: input.burnUp.map((point) => point.date),
    completed,
    scope,
    ideal:
      lastDay === undefined
        ? []
        : idealLine(
            input.scope,
            cycleDayCount(input.startsAt, input.endsAt),
            elapsedDayCount(input.startsAt, input.endsAt, lastDay),
          ),
    max: Math.max(1, input.scope, ...completed, ...scope),
  };
}
