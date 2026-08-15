import { describe, expect, test } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { ScatterPlot } from '../../../src/features/analytics/charts/scatter-plot.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const points = [
  { issueId: 'issue-1', identifier: 'NOV-1', title: 'Fix flaky login test', days: 2.4 },
  { issueId: 'issue-2', identifier: 'NOV-2', title: 'Add scatterplot primitive', days: 5.1 },
  { issueId: 'issue-3', identifier: 'NOV-3', title: 'Refactor plot guides', days: 3.8 },
  { issueId: 'issue-4', identifier: 'NOV-4', title: 'Ship insights lens', days: 8.0 },
] as const;

const percentiles = { p25: 2.5, p50: 4.0, p75: 6.0, p95: 8.5 } as const;

describe('ScatterPlot', () => {
  test('renders one scatter hit per point', () => {
    render(
      <ScatterPlot label="Cycle time" percentiles={percentiles} points={points} unitLabel="days" />,
    );

    for (const point of points) {
      expect(screen.getByTestId(`plot-scatter-${point.identifier}`)).toBeInTheDocument();
    }
  });

  test('draws the four percentile lines with right-edge labels', () => {
    render(
      <ScatterPlot label="Cycle time" percentiles={percentiles} points={points} unitLabel="days" />,
    );

    expect(screen.getByTestId('plot-percentile-p25')).toBeInTheDocument();
    expect(screen.getByTestId('plot-percentile-p50')).toBeInTheDocument();
    expect(screen.getByTestId('plot-percentile-p75')).toBeInTheDocument();
    expect(screen.getByTestId('plot-percentile-p95')).toBeInTheDocument();
    expect(screen.getByText('4.0 days')).toBeInTheDocument();
    expect(screen.getByText('8.5 days')).toBeInTheDocument();
  });

  test('hovering a point shows its identifier and formatted duration', async () => {
    const user = userEvent.setup();
    render(
      <ScatterPlot label="Cycle time" percentiles={percentiles} points={points} unitLabel="days" />,
    );

    await user.hover(screen.getByTestId('plot-scatter-NOV-2'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('NOV-2');
    expect(tooltip).toHaveTextContent('Add scatterplot primitive');
    expect(tooltip).toHaveTextContent('5.1 days');
  });

  test('hovering a point formats its value with the given unit label, not a hardcoded days suffix', async () => {
    const user = userEvent.setup();
    render(
      <ScatterPlot
        label="Time in review"
        percentiles={percentiles}
        points={points}
        unitLabel="hours"
      />,
    );

    await user.hover(screen.getByTestId('plot-scatter-NOV-2'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('5.1 hours');
    expect(tooltip).not.toHaveTextContent('5.1 days');
  });

  test('hovering a percentile line shows its exact value', async () => {
    const user = userEvent.setup();
    render(
      <ScatterPlot label="Cycle time" percentiles={percentiles} points={points} unitLabel="days" />,
    );

    await user.hover(screen.getByTestId('plot-percentile-p75'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('75th percentile');
    expect(tooltip).toHaveTextContent('6.0 days');
  });

  test('links each point at the issue route', () => {
    render(
      <ScatterPlot label="Cycle time" percentiles={percentiles} points={points} unitLabel="days" />,
    );

    const hit = screen.getByTestId('plot-scatter-NOV-1');
    const anchor = hit.closest('a');
    expect(anchor).toHaveAttribute('href', '/issue/NOV-1');
    expect(anchor).toHaveAttribute('aria-label', 'NOV-1 Fix flaky login test');
  });

  test('walks points by rank with arrow keys, Home, End, and Escape', async () => {
    const user = userEvent.setup();
    render(<ScatterPlot label="Cycle time" percentiles={null} points={points} unitLabel="days" />);

    const plot = screen.getByRole('application', { name: 'Cycle time' });
    await user.tab();
    expect(plot).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('NOV-1');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('NOV-3');

    await user.keyboard('{End}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('NOV-4');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('NOV-1');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('focuses the active anchor on the first Enter and lets a second Enter navigate', async () => {
    const user = userEvent.setup();
    render(<ScatterPlot label="Cycle time" percentiles={null} points={points} unitLabel="days" />);

    const plot = screen.getByRole('application', { name: 'Cycle time' });
    await user.tab();
    expect(plot).toHaveFocus();

    await user.keyboard('{Enter}');
    const anchor = document.activeElement;
    expect(anchor).not.toBe(plot);
    expect(anchor?.tagName.toLowerCase()).toBe('a');
    expect(anchor).toHaveAttribute('href', '/issue/NOV-1');

    const secondEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    anchor?.dispatchEvent(secondEnter);
    expect(secondEnter.defaultPrevented).toBe(false);
  });

  test('shows an empty state with no percentile lines when there are no points', () => {
    render(
      <ScatterPlot label="Cycle time" percentiles={percentiles} points={[]} unitLabel="days" />,
    );

    expect(screen.getByText('No completed issues in range yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-percentile-p50')).not.toBeInTheDocument();
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
  });
});
