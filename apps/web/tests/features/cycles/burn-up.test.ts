import { describe, expect, it } from 'bun:test';
import type { BurnUpPoint } from '@orbit/core';
import {
  buildBurnUp,
  burnUpMetric,
  cycleDayCount,
  elapsedDayCount,
  idealLine,
} from '../../../src/features/cycles/burn-up.ts';

const STARTS = new Date('2026-07-13T00:00:00.000Z');
const ENDS = new Date('2026-07-27T00:00:00.000Z');

function point(
  date: string,
  values: { scope: number; completed: number; scopePoints?: number; completedPoints?: number },
): BurnUpPoint {
  return {
    date,
    scope: values.scope,
    completed: values.completed,
    scopePoints: values.scopePoints ?? values.scope,
    completedPoints: values.completedPoints ?? values.completed,
  };
}

describe('cycleDayCount', () => {
  it('counts the whole cycle in days', () => {
    expect(cycleDayCount(STARTS, ENDS)).toBe(14);
  });

  it('never returns zero for a same day cycle', () => {
    expect(cycleDayCount(STARTS, STARTS)).toBe(1);
  });

  it('counts the days the sprint covers, not the hours between its ends', () => {
    expect(
      cycleDayCount(new Date('2026-07-13T09:00:00.000Z'), new Date('2026-07-27T21:00:00.000Z')),
    ).toBe(14);
    expect(
      cycleDayCount(new Date('2026-07-13T22:00:00.000Z'), new Date('2026-07-27T09:00:00.000Z')),
    ).toBe(14);
  });
});

describe('elapsedDayCount', () => {
  it('measures from the first day of the sprint to the last day drawn', () => {
    expect(elapsedDayCount(STARTS, ENDS, '2026-07-16')).toBe(3);
  });

  it('never runs past the end of the sprint or before its start', () => {
    expect(elapsedDayCount(STARTS, ENDS, '2026-08-30')).toBe(14);
    expect(elapsedDayCount(STARTS, ENDS, '2026-07-01')).toBe(0);
    expect(elapsedDayCount(STARTS, ENDS, undefined)).toBe(0);
  });
});

describe('idealLine', () => {
  it('rises linearly from zero to the scope across the cycle', () => {
    expect(idealLine(14, 14, 14).at(0)).toBe(0);
    expect(idealLine(14, 14, 14).at(-1)).toBe(14);
    expect(idealLine(14, 14, 14)).toHaveLength(15);
  });

  it('stops at the elapsed day rather than the end of the cycle', () => {
    expect(idealLine(10, 10, 3)).toEqual([0, 1, 2, 3]);
  });
});

describe('burnUpMetric', () => {
  it('counts issues until something in the sprint carries an estimate', () => {
    expect(burnUpMetric(0)).toBe('issues');
    expect(burnUpMetric(2)).toBe('points');
  });
});

describe('buildBurnUp', () => {
  it('produces labels, the completed series and a matching ideal line', () => {
    const series = buildBurnUp({
      scope: 8,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        point('2026-07-13', { scope: 8, completed: 0 }),
        point('2026-07-14', { scope: 8, completed: 1 }),
        point('2026-07-15', { scope: 8, completed: 1 }),
        point('2026-07-16', { scope: 8, completed: 3 }),
        point('2026-07-17', { scope: 8, completed: 5 }),
      ],
    });

    expect(series.labels).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
    ]);
    expect(series.completed).toEqual([0, 1, 1, 3, 5]);
    expect(series.ideal).toEqual([0, 8 / 14, 16 / 14, 24 / 14, 32 / 14]);
    expect(series.ideal).toHaveLength(series.completed.length);
    expect(series.max).toBe(8);
  });

  it('draws the scope the sprint actually carried on each day', () => {
    const series = buildBurnUp({
      scope: 5,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        point('2026-07-13', { scope: 3, completed: 0 }),
        point('2026-07-14', { scope: 3, completed: 1 }),
        point('2026-07-15', { scope: 5, completed: 1 }),
      ],
    });
    expect(series.scope).toEqual([3, 3, 5]);
  });

  it('reads points off the series when the sprint is estimated', () => {
    const series = buildBurnUp({
      metric: 'points',
      scope: 21,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        point('2026-07-13', { scope: 3, completed: 0, scopePoints: 13, completedPoints: 0 }),
        point('2026-07-14', { scope: 4, completed: 1, scopePoints: 21, completedPoints: 8 }),
      ],
    });
    expect(series.scope).toEqual([13, 21]);
    expect(series.completed).toEqual([0, 8]);
    expect(series.max).toBe(21);
  });

  it('takes the ideal line all the way to the scope on the last day of a finished sprint', () => {
    const startsAt = new Date('2026-07-13T09:00:00.000Z');
    const endsAt = new Date('2026-07-20T21:00:00.000Z');
    const series = buildBurnUp({
      scope: 7,
      startsAt,
      endsAt,
      burnUp: [
        point('2026-07-13', { scope: 7, completed: 0 }),
        point('2026-07-14', { scope: 7, completed: 1 }),
        point('2026-07-15', { scope: 7, completed: 2 }),
        point('2026-07-16', { scope: 7, completed: 3 }),
        point('2026-07-17', { scope: 7, completed: 4 }),
        point('2026-07-18', { scope: 7, completed: 4 }),
        point('2026-07-19', { scope: 7, completed: 6 }),
        point('2026-07-20', { scope: 7, completed: 7 }),
      ],
    });
    expect(series.ideal).toHaveLength(series.labels.length);
    expect(series.ideal.at(-1)).toBe(7);
  });

  it('keeps the ideal line from climbing past the scope on a lopsided sprint', () => {
    const startsAt = new Date('2026-07-13T22:00:00.000Z');
    const endsAt = new Date('2026-07-16T09:00:00.000Z');
    const series = buildBurnUp({
      scope: 4,
      startsAt,
      endsAt,
      burnUp: [
        point('2026-07-13', { scope: 4, completed: 0 }),
        point('2026-07-14', { scope: 4, completed: 1 }),
        point('2026-07-15', { scope: 4, completed: 2 }),
        point('2026-07-16', { scope: 4, completed: 4 }),
      ],
    });
    expect(series.ideal).toEqual([0, 4 / 3, 8 / 3, 4]);
  });

  it('keeps the axis above the completed count when scope lags behind', () => {
    const series = buildBurnUp({
      scope: 2,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        point('2026-07-13', { scope: 2, completed: 0 }),
        point('2026-07-14', { scope: 2, completed: 5 }),
      ],
    });
    expect(series.max).toBe(5);
  });

  it('keeps the axis above a scope that peaked higher than the sprint ended on', () => {
    const series = buildBurnUp({
      metric: 'points',
      scope: 13,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        point('2026-07-13', { scope: 3, completed: 0, scopePoints: 8, completedPoints: 0 }),
        point('2026-07-14', { scope: 6, completed: 1, scopePoints: 21, completedPoints: 5 }),
        point('2026-07-15', { scope: 4, completed: 2, scopePoints: 13, completedPoints: 8 }),
      ],
    });
    expect(series.max).toBe(21);
  });

  it('survives an empty burn up', () => {
    const series = buildBurnUp({ scope: 0, startsAt: STARTS, endsAt: ENDS, burnUp: [] });
    expect(series).toEqual({ labels: [], completed: [], scope: [], ideal: [], max: 1 });
  });
});
