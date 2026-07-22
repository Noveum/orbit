import type { BurnUpPoint } from '@orbit/core';

export interface BurnUpSeries {
  readonly labels: string[];
  readonly completed: number[];
  readonly ideal: number[];
  readonly max: number;
}

export interface BurnUpInput {
  readonly burnUp: readonly BurnUpPoint[];
  readonly scope: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const DAY_MS = 86_400_000;

export function cycleDayCount(startsAt: Date, endsAt: Date): number {
  const days = Math.round((endsAt.getTime() - startsAt.getTime()) / DAY_MS);
  return Math.max(1, days);
}

export function idealLine(scope: number, totalDays: number, elapsedDays: number): number[] {
  const points: number[] = [];
  for (let day = 0; day <= elapsedDays; day += 1) {
    points.push((scope * day) / totalDays);
  }
  return points;
}

export function buildBurnUp(input: BurnUpInput): BurnUpSeries {
  const completed = input.burnUp.map((point) => point.completed);
  const totalDays = cycleDayCount(input.startsAt, input.endsAt);
  const elapsedDays = Math.max(0, input.burnUp.length - 1);
  return {
    labels: input.burnUp.map((point) => point.date),
    completed,
    ideal: idealLine(input.scope, totalDays, elapsedDays),
    max: Math.max(1, input.scope, ...completed),
  };
}
