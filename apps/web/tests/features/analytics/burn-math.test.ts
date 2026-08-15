import { describe, expect, test } from 'bun:test';
import {
  actualPace,
  burnForecast,
  forecastDate,
  neededPace,
  personCaptureCaption,
  personIdealSeries,
  readableDate,
  sprintDays,
  todayDateOf,
  unestimatedNote,
} from '../../../src/features/analytics/burn-math.ts';

const point = (
  date: string,
  workingDay: number | null,
  extra: Partial<{
    available: boolean;
    future: boolean;
    completed: number;
    remaining: number;
    ideal: number;
  }> = {},
) => ({
  date,
  workingDay,
  available: extra.available ?? true,
  future: extra.future ?? false,
  completed: extra.completed ?? 0,
  remaining: extra.remaining ?? 0,
  ideal: extra.ideal ?? 0,
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

  test('actual pace divides completed by working days elapsed since sprint start, not since capture began', () => {
    const burn = [
      point('2026-08-11', 1, { available: false }),
      point('2026-08-13', 3, { completed: 2 }),
      point('2026-08-14', 4, { completed: 5 }),
    ];
    expect(actualPace(burn)).toBeCloseTo(5 / 4, 5);
  });

  test('mid-flight adoption does not inflate pace from a late capture start', () => {
    const burn = [
      point('2026-08-11', 1, { available: false }),
      point('2026-08-12', 2, { available: false }),
      point('2026-08-13', 3, { completed: 9 }),
      point('2026-08-14', 4, { completed: 16 }),
    ];
    expect(actualPace(burn)).toBeCloseTo(4, 5);
  });

  test('needed pace uses the last working day in the series even when the sprint ends on a weekend', () => {
    const mondayToMondayBurn = [
      point('2026-08-03', 1),
      point('2026-08-04', 2),
      point('2026-08-05', 3),
      point('2026-08-06', 4),
      point('2026-08-07', 5),
      point('2026-08-08', null),
      point('2026-08-09', null),
      point('2026-08-10', 6),
      point('2026-08-11', 7),
      point('2026-08-12', 8, { remaining: 6 }),
      point('2026-08-13', 9, { future: true }),
      point('2026-08-14', 10, { future: true }),
      point('2026-08-15', null, { future: true }),
      point('2026-08-16', null, { future: true }),
    ];
    expect(neededPace(6, mondayToMondayBurn)).toBeCloseTo(2, 5);
  });
});

describe('forecastDate', () => {
  test('maps a completion working day to a calendar date beyond the series', () => {
    const burn = [point('2026-08-13', 1), point('2026-08-14', 2)];
    expect(forecastDate(burn, 4)).toBe('2026-08-18');
  });

  test('walks forward from the last working day even when the sprint ends on a weekend', () => {
    const mondayToMondayBurn = [
      point('2026-08-03', 1),
      point('2026-08-04', 2),
      point('2026-08-05', 3),
      point('2026-08-06', 4),
      point('2026-08-07', 5),
      point('2026-08-08', null),
      point('2026-08-09', null),
      point('2026-08-10', 6),
      point('2026-08-11', 7),
      point('2026-08-12', 8),
      point('2026-08-13', 9, { future: true }),
      point('2026-08-14', 10, { future: true }),
      point('2026-08-15', null, { future: true }),
      point('2026-08-16', null, { future: true }),
    ];
    expect(forecastDate(mondayToMondayBurn, 12)).toBe('2026-08-18');
  });
});

describe('burnForecast', () => {
  test('projects a completion working day from a real declining slope', () => {
    const burn = [
      point('2026-08-11', 1, { remaining: 20 }),
      point('2026-08-12', 2, { remaining: 15 }),
      point('2026-08-13', 3, { remaining: 10 }),
    ];
    expect(burnForecast(burn)?.completionWorkingDay).toBe(5);
  });

  test('returns null instead of a runaway forecast when the slope is nearly flat', () => {
    const burn = [
      point('2026-08-11', 1, { remaining: 50 }),
      point('2026-08-12', 2, { remaining: 49.9 }),
      point('2026-08-13', 3, { remaining: 49.8 }),
    ];
    expect(burnForecast(burn)).toBeNull();
  });
});

describe('todayDateOf', () => {
  test('picks the last non-future date', () => {
    const burn = [
      point('2026-08-13', 1),
      point('2026-08-14', 2),
      point('2026-08-17', 3, { future: true }),
    ];
    expect(todayDateOf(burn)).toBe('2026-08-14');
  });

  test('falls back to the last date when every point is future', () => {
    const burn = [
      point('2026-08-13', 1, { future: true }),
      point('2026-08-14', 2, { future: true }),
    ];
    expect(todayDateOf(burn)).toBe('2026-08-14');
  });

  test('returns an empty string for an empty burn', () => {
    expect(todayDateOf([])).toBe('');
  });
});

describe('readableDate', () => {
  test('formats an ISO date as a short month, day, year', () => {
    expect(readableDate('2026-08-14')).toBe('Aug 14, 2026');
  });
});

describe('unestimatedNote', () => {
  test('uses singular wording for exactly one unestimated issue', () => {
    expect(unestimatedNote(1)).toBe('1 unestimated issue counts as 1 point.');
  });

  test('uses plural wording for any other count', () => {
    expect(unestimatedNote(2)).toBe('2 unestimated issues count as 1 point each.');
    expect(unestimatedNote(0)).toBe('0 unestimated issues count as 1 point each.');
  });
});

describe('personCaptureCaption', () => {
  test('is undefined when capture starts on day one', () => {
    const burn = [point('2026-08-13', 1), point('2026-08-14', 2)];
    expect(personCaptureCaption(burn)).toBeUndefined();
  });

  test('is undefined when no day is available yet', () => {
    const burn = [
      point('2026-08-13', 1, { available: false, future: true }),
      point('2026-08-14', 2, { available: false, future: true }),
    ];
    expect(personCaptureCaption(burn)).toBeUndefined();
  });

  test('states the capture start when earlier days precede the first captured day', () => {
    const burn = [
      point('2026-08-13', 1, { available: false }),
      point('2026-08-14', 2, { available: false }),
      point('2026-08-17', 3),
    ];
    expect(personCaptureCaption(burn)).toBe(
      'Capture began Aug 17, 2026. Earlier days show targets only.',
    );
  });
});

describe('personIdealSeries', () => {
  test('includes every point, captured or not, using the ideal value', () => {
    const burn = [
      point('2026-08-13', 1, { available: false, ideal: 10 }),
      point('2026-08-14', 2, { ideal: 8 }),
    ];
    const series = personIdealSeries(burn);
    expect(series).toMatchObject({
      id: 'ideal-person',
      label: 'Ideal',
      color: 2,
      dashed: true,
      dots: true,
    });
    expect(series.points.map((entry) => entry.value)).toEqual([10, 8]);
  });
});
