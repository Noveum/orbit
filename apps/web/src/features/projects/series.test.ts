import { describe, expect, it } from 'bun:test';
import { buildProjectSeries } from './series.ts';

const NOW = new Date('2026-07-11T00:00:00.000Z');

describe('buildProjectSeries', () => {
  it('returns nothing when the project has no issues', () => {
    expect(buildProjectSeries([], NOW)).toEqual([]);
  });

  it('accumulates scope and completed across evenly spaced points', () => {
    const series = buildProjectSeries(
      [
        { createdAt: new Date('2026-07-01T00:00:00.000Z'), completedAt: null },
        {
          createdAt: new Date('2026-07-06T00:00:00.000Z'),
          completedAt: new Date('2026-07-11T00:00:00.000Z'),
        },
        { createdAt: new Date('2026-07-11T00:00:00.000Z'), completedAt: null },
      ],
      NOW,
      3,
    );

    expect(series).toEqual([
      { date: '2026-07-01', scope: 1, completed: 0 },
      { date: '2026-07-06', scope: 2, completed: 0 },
      { date: '2026-07-11', scope: 3, completed: 1 },
    ]);
  });

  it('never plots a completed count above the scope', () => {
    const series = buildProjectSeries(
      [
        {
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          completedAt: new Date('2026-07-05T00:00:00.000Z'),
        },
      ],
      NOW,
    );
    for (const point of series) {
      expect(point.completed).toBeLessThanOrEqual(point.scope);
    }
    expect(series.at(-1)).toEqual({ date: '2026-07-11', scope: 1, completed: 1 });
  });
});
