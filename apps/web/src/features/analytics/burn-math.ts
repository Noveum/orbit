import type { SprintBurnPoint } from '@orbit/core';
import type { PlotPoint, PlotSeries } from './charts/line-plot.tsx';

export type BurnPointLike = Pick<
  SprintBurnPoint,
  'date' | 'workingDay' | 'available' | 'future' | 'completed' | 'remaining'
>;

export type PersonBurnPointLike = BurnPointLike & { readonly ideal: number };

export interface SprintDay {
  readonly date: string;
  readonly weekend: boolean;
  readonly today: boolean;
  readonly future: boolean;
}

const DAY = 86_400_000;
const MAX_FORECAST_WORKING_DAYS_AHEAD = 90;

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

export function todayDateOf(burn: readonly BurnPointLike[]): string {
  return burn.filter((point) => !point.future).at(-1)?.date ?? burn.at(-1)?.date ?? '';
}

export function readableDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`));
}

export function personCaptureCaption(burn: readonly BurnPointLike[]): string | undefined {
  const firstAvailableIndex = burn.findIndex((point) => point.available);
  if (firstAvailableIndex <= 0) return undefined;
  const hasEarlierGap = burn
    .slice(0, firstAvailableIndex)
    .some((point) => !(point.available || point.future));
  if (!hasEarlierGap) return undefined;
  const firstAvailable = burn[firstAvailableIndex];
  return firstAvailable === undefined
    ? undefined
    : `Capture began ${readableDate(firstAvailable.date)}. Earlier days show targets only.`;
}

export function unestimatedNote(count: number): string {
  return count === 1
    ? '1 unestimated issue counts as 1 point.'
    : `${count} unestimated issues count as 1 point each.`;
}

export function personIdealSeries(burn: readonly PersonBurnPointLike[]): PlotSeries {
  return {
    id: 'ideal-person',
    label: 'Ideal',
    color: 2,
    dashed: true,
    dots: true,
    points: burn.map((point) => ({
      id: `${point.date}-ideal-person`,
      label: point.date,
      value: point.ideal,
      cohort: { cohort: 'open' as const },
    })),
  };
}

function lastWithWorkingDay(burn: readonly BurnPointLike[]): BurnPointLike | undefined {
  return burn.findLast((point) => point.workingDay != null);
}

export function neededPace(remaining: number, burn: readonly BurnPointLike[]): number | null {
  const current = burn
    .filter((point) => !point.future)
    .reverse()
    .find((point) => point.workingDay != null);
  const last = lastWithWorkingDay(burn);
  if (current?.workingDay == null || last?.workingDay == null) return null;
  const daysLeft = last.workingDay - current.workingDay + 1;
  return daysLeft <= 0 ? null : remaining / daysLeft;
}

export function actualPace(burn: readonly BurnPointLike[]): number | null {
  const current = burn
    .filter((point) => !point.future)
    .reverse()
    .find((point) => point.workingDay != null);
  if (current?.workingDay == null) return null;
  return current.completed / Math.max(1, current.workingDay);
}

export function forecastDate(
  burn: readonly BurnPointLike[],
  completionWorkingDay: number,
): string | null {
  const inSeries = burn.find((point) => point.workingDay === completionWorkingDay);
  if (inSeries !== undefined) return inSeries.date;
  const last = lastWithWorkingDay(burn);
  if (last?.workingDay == null) return null;
  let date = last.date;
  let workingDay = last.workingDay;
  while (workingDay < completionWorkingDay) {
    date = nextDate(date);
    if (!isWeekend(date)) workingDay += 1;
  }
  return date;
}

export function burnForecast(
  burn: readonly BurnPointLike[],
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
  if (completionWorkingDay - last.workingDay > MAX_FORECAST_WORKING_DAYS_AHEAD) return null;
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
