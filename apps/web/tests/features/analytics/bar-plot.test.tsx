import { describe, expect, mock, test } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { BarPlot } from '../../../src/features/analytics/charts/bar-plot.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const point = (index: number, value = index) => ({
  id: `state-${index}`,
  label: `State ${index}`,
  value,
  cohort: { cohort: 'state' as const, bucket: String(index) },
});

const pairs = [
  {
    id: 'alice',
    label: 'Alice',
    primary: {
      id: 'alice-primary',
      label: 'This sprint',
      value: 5,
      cohort: { cohort: 'state' as const, bucket: 'alice-current' },
    },
    secondary: {
      id: 'alice-secondary',
      label: 'Last sprint',
      value: 2,
      cohort: { cohort: 'state' as const, bucket: 'alice-previous' },
    },
  },
  {
    id: 'bob',
    label: 'Bob',
    primary: {
      id: 'bob-primary',
      label: 'This sprint',
      value: 3,
      cohort: { cohort: 'state' as const, bucket: 'bob-current' },
    },
    secondary: {
      id: 'bob-secondary',
      label: 'Last sprint',
      value: 10,
      cohort: { cohort: 'state' as const, bucket: 'bob-previous' },
    },
  },
];

describe('BarPlot', () => {
  test('offers exact table activation and a pointer target for zero values', async () => {
    const activate = mock();
    const user = userEvent.setup();
    render(
      <BarPlot label="Workflow state" onActivate={activate} points={[point(0, 0), point(1, 4)]} />,
    );

    expect(Number(screen.getByTestId('plot-hit-state-0').getAttribute('height'))).toBeGreaterThan(
      0,
    );
    await user.click(screen.getByText('View data (2 rows)'));
    await user.click(screen.getByRole('button', { name: 'State 1, Workflow state 4' }));
    expect(activate).toHaveBeenCalledWith({ cohort: 'state', bucket: '1' });
  });

  test('keeps every bar inside the chart and clears stale pointer hover', async () => {
    const user = userEvent.setup();
    render(
      <BarPlot
        label="Many projects"
        onActivate={mock()}
        points={Array.from({ length: 80 }, (_, index) => point(index, 1))}
      />,
    );

    const last = screen.getByTestId('plot-hit-state-79');
    expect(
      Number(last.getAttribute('y')) + Number(last.getAttribute('height')),
    ).toBeLessThanOrEqual(
      Number(screen.getByRole('application', { name: 'Many projects' }).getAttribute('height')),
    );
    await user.hover(last);
    expect(screen.getByRole('tooltip')).toHaveTextContent('State 79');
    await user.unhover(screen.getByRole('application', { name: 'Many projects' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('supports inspection without presenting evidence actions', async () => {
    const user = userEvent.setup();
    render(<BarPlot label="Velocity" points={[point(0, 3)]} />);

    await user.hover(screen.getByTestId('plot-hit-state-0'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('State 0');
    expect(screen.queryByRole('button', { name: 'State 0, Velocity 3' })).not.toBeInTheDocument();
  });

  test('shows a readable scale and anchors the exact tooltip to its bar', async () => {
    const user = userEvent.setup();
    render(
      <BarPlot
        label="Velocity"
        points={[point(0, 3), point(1, 8)]}
        xAxisLabel="Issues completed"
      />,
    );

    expect(screen.getAllByTestId('plot-grid-line')).toHaveLength(3);
    expect(screen.getByTestId('plot-x-max')).toHaveTextContent('8');
    expect(screen.getByTestId('plot-x-zero')).toHaveTextContent('0');
    expect(screen.getByTestId('plot-x-axis-label')).toHaveTextContent('Issues completed');
    expect(screen.getByTestId('plot-x-axis-label').getAttribute('fill')).toBe('var(--color-muted)');
    expect(screen.getByTestId('plot-x-max').getAttribute('fill')).toBe('var(--color-faint)');
    expect(screen.getByTestId('plot-category-state-0')).toHaveTextContent('State 0');
    expect(screen.getByTestId('plot-value-state-1')).toHaveTextContent('8');

    await user.hover(screen.getByTestId('plot-hit-state-1'));
    expect(screen.getByRole('tooltip').getAttribute('style')).toContain('left:');
    expect(screen.getByRole('tooltip').getAttribute('style')).toContain('top:');
  });

  test('renders the svg at the measured width instead of stretching a viewBox', () => {
    render(<BarPlot label="Velocity" points={[point(0, 3)]} />);

    const svg = screen.getByRole('application');
    expect(svg.getAttribute('viewBox')).toBeNull();
    expect(svg.getAttribute('width')).toBe('640');
  });

  test('renders both bars per pair row, colored and sized from the max across every pair', () => {
    render(<BarPlot label="Sprint velocity" pairs={pairs} points={[]} />);

    const svg = screen.getByRole('application', { name: 'Sprint velocity' });
    expect(svg.getAttribute('viewBox')).toBeNull();
    expect(svg.getAttribute('width')).toBe('640');

    const alicePrimary = screen.getByTestId('plot-bar-primary-alice');
    const aliceSecondary = screen.getByTestId('plot-bar-secondary-alice');
    const bobSecondary = screen.getByTestId('plot-bar-secondary-bob');

    expect(alicePrimary.getAttribute('fill')).toBe('var(--analytics-series-1)');
    expect(aliceSecondary.getAttribute('fill')).toBe('var(--color-border-strong)');
    expect(alicePrimary.getAttribute('height')).toBe('8');
    expect(aliceSecondary.getAttribute('height')).toBe('8');

    expect(alicePrimary.getAttribute('width')).toBe('203');
    expect(bobSecondary.getAttribute('width')).toBe('406');
  });

  test('draws the average line at the correct proportion with its label, absent when not provided', () => {
    const { rerender } = render(<BarPlot label="Sprint velocity" pairs={pairs} points={[]} />);
    expect(screen.queryByTestId('plot-average-line')).not.toBeInTheDocument();

    rerender(
      <BarPlot
        averageLine={{ value: 5, label: 'Avg 5' }}
        label="Sprint velocity"
        pairs={pairs}
        points={[]}
      />,
    );

    const line = screen.getByTestId('plot-average-line');
    expect(line.getAttribute('x1')).toBe('373');
    expect(line.getAttribute('x2')).toBe('373');
    expect(line.getAttribute('y1')).toBe('12');
    expect(line.getAttribute('y2')).toBe('72');
    expect(line.getAttribute('stroke')).toBe('var(--color-border-strong)');
    expect(line.getAttribute('stroke-dasharray')).toBe('4 4');
    expect(screen.getByText('Avg 5')).toBeVisible();
  });

  test('keeps the existing keyboard model working across pair rows, activating the primary cohort on Enter', async () => {
    const activate = mock();
    const user = userEvent.setup();
    render(<BarPlot label="Sprint velocity" onActivate={activate} pairs={pairs} points={[]} />);

    const plot = screen.getByRole('application', { name: 'Sprint velocity' });
    await user.tab();
    expect(plot).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(activate).toHaveBeenCalledWith({ cohort: 'state', bucket: 'bob-current' });
  });
});
