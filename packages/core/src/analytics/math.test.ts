import { describe, expect, it } from 'bun:test';
import { churnFromScopeSeries, distributionOf, idealRemaining, percentile } from './math.ts';

describe('percentile', () => {
  it('returns 0 for an empty set', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the only value regardless of quantile', () => {
    expect(percentile([7], 0.85)).toBe(7);
  });

  it('interpolates p50 and p85 on a known set', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBeCloseTo(5.5, 5);
    expect(percentile(values, 0.85)).toBeCloseTo(8.65, 5);
  });

  it('clamps out of range quantiles', () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });
});

describe('distributionOf', () => {
  it('reports count, percentiles and average', () => {
    const dist = distributionOf([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(dist.count).toBe(8);
    expect(dist.average).toBeCloseTo(5, 5);
    expect(dist.min).toBe(2);
    expect(dist.max).toBe(9);
    expect(dist.p50).toBeCloseTo(4.5, 5);
  });
});

describe('idealRemaining', () => {
  it('burns from full scope to zero across the calendar', () => {
    expect(idealRemaining(100, 0, 10)).toBe(100);
    expect(idealRemaining(100, 5, 10)).toBe(50);
    expect(idealRemaining(100, 10, 10)).toBe(0);
  });

  it('lifts with scope creep so a larger scope raises the line', () => {
    expect(idealRemaining(120, 5, 10)).toBe(60);
    expect(idealRemaining(120, 5, 10)).toBeGreaterThan(idealRemaining(100, 5, 10));
  });
});

describe('churnFromScopeSeries', () => {
  it('separates work added from work removed after the start', () => {
    const churn = churnFromScopeSeries([10, 10, 13, 13, 11, 12]);
    expect(churn.added).toBe(4);
    expect(churn.removed).toBe(2);
  });

  it('is zero for a flat scope', () => {
    expect(churnFromScopeSeries([8, 8, 8])).toEqual({ added: 0, removed: 0 });
  });
});
