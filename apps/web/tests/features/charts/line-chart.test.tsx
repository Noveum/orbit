import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { type ChartSeries, LineChart } from '../../../src/features/charts/line-chart.tsx';

afterEach(cleanup);

function singlePoint(max: number): ChartSeries {
  return { id: 'scope', label: 'Scope', tone: 'accent', filled: false, values: [max] };
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
    const circle = container.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(Number(circle!.getAttribute('cx'))).toBe(160);
    const paths = container.querySelectorAll('path');
    for (const path of paths) {
      expect(path.getAttribute('d')).not.toBe('');
    }
    expect(screen.getByLabelText('Weekly scope')).not.toBeNull();
  });

  it('still draws a line for multi-point series', () => {
    const { container } = render(
      <LineChart
        title="Scope and completed over time"
        description="Weekly scope"
        series={[
          { id: 'scope', label: 'Scope', tone: 'accent', filled: false, values: [0, 5, 10] },
        ]}
        labels={['w1', 'w2', 'w3']}
        max={10}
      />,
    );
    expect(container.querySelector('circle')).toBeNull();
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });
});
