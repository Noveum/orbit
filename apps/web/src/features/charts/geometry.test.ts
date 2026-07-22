import { describe, expect, it } from 'vitest';
import {
  areaPath,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  chartX,
  chartY,
  linePath,
} from './geometry.ts';

describe('chartX', () => {
  it('spreads points across the padded width', () => {
    expect(chartX(0, 3)).toBe(CHART_PADDING);
    expect(chartX(2, 3)).toBe(CHART_WIDTH - CHART_PADDING);
  });

  it('centres a single point', () => {
    expect(chartX(0, 1)).toBe(CHART_WIDTH / 2);
  });
});

describe('chartY', () => {
  it('puts zero on the baseline and the max at the top', () => {
    expect(chartY(0, 10)).toBe(CHART_HEIGHT - CHART_PADDING);
    expect(chartY(10, 10)).toBe(CHART_PADDING);
  });

  it('clamps values above the max', () => {
    expect(chartY(50, 10)).toBe(chartY(10, 10));
  });

  it('treats a zero max as one so the axis never divides by zero', () => {
    expect(Number.isFinite(chartY(0, 0))).toBe(true);
  });
});

describe('linePath', () => {
  it('starts with a move and continues with line commands', () => {
    expect(linePath([0, 5, 10], 10)).toBe('M6.00 126.00 L160.00 66.00 L314.00 6.00');
  });

  it('returns nothing for an empty series', () => {
    expect(linePath([], 10)).toBe('');
  });
});

describe('areaPath', () => {
  it('closes the line back down to the baseline', () => {
    expect(areaPath([0, 10], 10)).toContain('Z');
    expect(areaPath([], 10)).toBe('');
  });
});
