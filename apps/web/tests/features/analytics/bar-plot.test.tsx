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
});
