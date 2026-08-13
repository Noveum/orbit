import { describe, expect, it } from 'bun:test';
import { DEFAULT_ESTIMATE_SCALE } from '@orbit/shared/constants';
import { render, screen } from '@testing-library/react';
import { EstimateGlyph, estimateLabel } from '@/features/issues/estimate-glyph.tsx';

function filledWidth(label: string): number {
  const rect = screen.getByLabelText(label).querySelector('clipPath rect');
  return Number(rect?.getAttribute('width') ?? '0');
}

describe('estimateLabel', () => {
  it('says no estimate when there is none', () => {
    expect(estimateLabel(null)).toBe('No estimate');
  });

  it('keeps a single point singular', () => {
    expect(estimateLabel(1)).toBe('1 point');
  });

  it('pluralises everything else, including zero', () => {
    expect(estimateLabel(0)).toBe('0 points');
    expect(estimateLabel(2)).toBe('2 points');
    expect(estimateLabel(13)).toBe('13 points');
  });
});

describe('EstimateGlyph', () => {
  it('labels itself for assistive technology', () => {
    render(<EstimateGlyph points={5} />);

    expect(screen.getByLabelText('5 points')).toBeInTheDocument();
  });

  it('leaves the triangle empty when there is no estimate', () => {
    render(<EstimateGlyph points={null} />);

    expect(filledWidth('No estimate')).toBe(0);
  });

  it('fills further as the estimate climbs the scale', () => {
    render(
      <>
        <EstimateGlyph points={0} />
        <EstimateGlyph points={2} />
        <EstimateGlyph points={13} />
      </>,
    );

    expect(filledWidth('0 points')).toBe(0);
    expect(filledWidth('2 points')).toBeGreaterThan(0);
    expect(filledWidth('13 points')).toBeGreaterThan(filledWidth('2 points'));
  });

  it('fills the triangle completely at the top of the scale', () => {
    const largest = DEFAULT_ESTIMATE_SCALE.at(-1) ?? 0;
    render(<EstimateGlyph points={largest} />);

    expect(filledWidth(estimateLabel(largest))).toBe(14);
  });

  it('ranks an estimate that is not on the scale by the steps below it', () => {
    render(
      <>
        <EstimateGlyph points={4} />
        <EstimateGlyph points={3} />
      </>,
    );

    expect(filledWidth('4 points')).toBe(filledWidth('3 points'));
  });

  it('clamps an estimate past the top of the scale', () => {
    render(<EstimateGlyph points={99} />);

    expect(filledWidth('99 points')).toBe(14);
  });
});
