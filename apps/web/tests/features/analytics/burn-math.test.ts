import { describe, expect, test } from 'bun:test';
import {
  actualPace,
  forecastDate,
  neededPace,
  sprintDays,
} from '../../../src/features/analytics/burn-math.ts';

const point = (
  date: string,
  workingDay: number | null,
  extra: Partial<{
    available: boolean;
    future: boolean;
    completed: number;
    remaining: number;
  }> = {},
) => ({
  date,
  workingDay,
  available: extra.available ?? true,
  future: extra.future ?? false,
  completed: extra.completed ?? 0,
  remaining: extra.remaining ?? 0,
});

describe('sprintDays', () => {
  test('flags weekends, today, and future days', () => {
    const days = sprintDays(
      [
        point('2026-08-13', 1),
        point('2026-08-14', 2),
        point('2026-08-15', null, { future: true }),
        point('2026-08-16', null, { future: true }),
        point('2026-08-17', 3, { future: true }),
      ],
      '2026-08-14',
    );
    expect(days.map((day) => day.weekend)).toEqual([false, false, true, true, false]);
    expect(days[1]?.today).toBe(true);
    expect(days[4]?.future).toBe(true);
  });
});

describe('pace', () => {
  test('needed pace divides remaining by working days left including today', () => {
    const burn = [
      point('2026-08-13', 1, { remaining: 8 }),
      point('2026-08-14', 2, { remaining: 7 }),
      point('2026-08-17', 3, { future: true }),
      point('2026-08-18', 4, { future: true }),
    ];
    expect(neededPace(7, burn)).toBeCloseTo(7 / 3, 5);
  });

  test('actual pace divides completed since baseline by elapsed working days', () => {
    const burn = [
      point('2026-08-11', 1, { available: false }),
      point('2026-08-13', 3, { completed: 2 }),
      point('2026-08-14', 4, { completed: 5 }),
    ];
    expect(actualPace(burn)).toBeCloseTo(5 / 2, 5);
  });
});

describe('forecastDate', () => {
  test('maps a completion working day to a calendar date beyond the series', () => {
    const burn = [point('2026-08-13', 1), point('2026-08-14', 2)];
    expect(forecastDate(burn, 4)).toBe('2026-08-18');
  });
});
