import type { SprintBurnPoint } from '@orbit/core';

export type BurnPointLike = Pick<
  SprintBurnPoint,
  'date' | 'workingDay' | 'available' | 'future' | 'completed' | 'remaining'
>;

export interface SprintDay {
  readonly date: string;
  readonly weekend: boolean;
  readonly today: boolean;
  readonly future: boolean;
}

const DAY = 86_400_000;

function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function isWeekend(date: string): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + DAY).toISOString().slice(0, 10);
}

export function sprintDays(burn: readonly BurnPointLike[], today: string): readonly SprintDay[] {
  return burn.map((point) => ({
    date: point.date,
    weekend: isWeekend(point.date),
    today: point.date === today,
    future: point.future,
  }));
}

export function neededPace(remaining: number, burn: readonly BurnPointLike[]): number | null {
  const current = burn
    .filter((point) => !point.future)
    .reverse()
    .find((point) => point.workingDay != null);
  const last = burn.at(-1);
  if (current?.workingDay == null || last?.workingDay == null) return null;
  const daysLeft = last.workingDay - current.workingDay + 1;
  return daysLeft <= 0 ? null : remaining / daysLeft;
}

export function actualPace(burn: readonly BurnPointLike[]): number | null {
  const observed = burn.filter((point) => point.available && !point.future);
  const first = observed[0];
  const current = observed.at(-1);
  if (first?.workingDay == null || current?.workingDay == null) return null;
  const elapsed = Math.max(1, current.workingDay - first.workingDay + 1);
  return current.completed / elapsed;
}

export function forecastDate(
  burn: readonly BurnPointLike[],
  completionWorkingDay: number,
): string | null {
  const inSeries = burn.find((point) => point.workingDay === completionWorkingDay);
  if (inSeries !== undefined) return inSeries.date;
  const last = burn.at(-1);
  if (last?.workingDay == null) return null;
  let date = last.date;
  let workingDay = last.workingDay;
  while (workingDay < completionWorkingDay) {
    date = nextDate(date);
    if (!isWeekend(date)) workingDay += 1;
  }
  return date;
}
