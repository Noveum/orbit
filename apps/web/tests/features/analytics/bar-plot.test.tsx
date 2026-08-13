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
    expect(Number(last.getAttribute('x')) + Number(last.getAttribute('width'))).toBeLessThanOrEqual(
      320,
    );
    await user.hover(last);
    expect(screen.getByRole('tooltip')).toHaveTextContent('State 79');
    await user.unhover(screen.getByRole('application', { name: 'Many projects' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
