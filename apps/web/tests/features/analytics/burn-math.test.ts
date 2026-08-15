import { describe, expect, test } from 'bun:test';
import {
  actualPace,
  forecastDate,
  neededPace,
  personCaptureCaption,
  personIdealSeries,
  readableDate,
  sprintDays,
  todayDateOf,
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
