import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { type ChartSeries, LineChart } from '../../../src/features/charts/line-chart.tsx';

afterEach(cleanup);

function singlePoint(max: number): ChartSeries {
  return { id: 'scope', label: 'Scope', tone: 'accent', filled: true, values: [max] };
}

describe('LineChart with a single point', () => {
  it('renders a dot instead of a zero-length path', () => {
    const { container } = render(
      <LineChart
        title="Scope and completed over time"
        description="Weekly scope"
        series={[singlePoint(10)]}
        labels={['2026-08-24']}
        max={10}
      />,
    );
    const dot = screen.getByTestId('chart-line-scope');
    expect(dot.tagName).toBe('line');
    expect(Number(dot.getAttribute('x1'))).toBe(160);
    expect(dot.getAttribute('x2')).toBe(dot.getAttribute('x1'));
    expect(dot.getAttribute('stroke-linecap')).toBe('round');
    expect(dot.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(container.querySelectorAll('path')).toHaveLength(0);
    expect(screen.getByLabelText('Weekly scope')).not.toBeNull();
  });

  it('still draws a line for multi-point series', () => {
    const { container } = render(
      <LineChart
        title="Scope and completed over time"
        description="Weekly scope"
        series={[{ id: 'scope', label: 'Scope', tone: 'accent', filled: true, values: [0, 5, 10] }]}
        labels={['w1', 'w2', 'w3']}
        max={10}
      />,
    );
    expect(screen.getByTestId('chart-line-scope').tagName).toBe('path');
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });
});
