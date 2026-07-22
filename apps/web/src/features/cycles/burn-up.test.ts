import { describe, expect, it } from 'vitest';
import { buildBurnUp, cycleDayCount, idealLine } from './burn-up.ts';

const STARTS = new Date('2026-07-13T00:00:00.000Z');
const ENDS = new Date('2026-07-27T00:00:00.000Z');

describe('cycleDayCount', () => {
  it('counts the whole cycle in days', () => {
    expect(cycleDayCount(STARTS, ENDS)).toBe(14);
  });

  it('never returns zero for a same day cycle', () => {
    expect(cycleDayCount(STARTS, STARTS)).toBe(1);
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

describe('buildBurnUp', () => {
  it('produces labels, the completed series and a matching ideal line', () => {
    const series = buildBurnUp({
      scope: 8,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        { date: '2026-07-13', completed: 0 },
        { date: '2026-07-14', completed: 1 },
        { date: '2026-07-15', completed: 1 },
        { date: '2026-07-16', completed: 3 },
        { date: '2026-07-17', completed: 5 },
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

  it('keeps the axis above the completed count when scope lags behind', () => {
    const series = buildBurnUp({
      scope: 2,
      startsAt: STARTS,
      endsAt: ENDS,
      burnUp: [
        { date: '2026-07-13', completed: 0 },
        { date: '2026-07-14', completed: 5 },
      ],
    });
    expect(series.max).toBe(5);
  });

  it('survives an empty burn up', () => {
    const series = buildBurnUp({ scope: 0, startsAt: STARTS, endsAt: ENDS, burnUp: [] });
    expect(series).toEqual({ labels: [], completed: [], ideal: [0], max: 1 });
  });
});
