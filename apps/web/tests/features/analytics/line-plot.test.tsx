import { describe, expect, mock, test } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { LinePlot } from '../../../src/features/analytics/charts/line-plot.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const series = [
  {
    id: 'completed',
    label: 'Completed',
    points: [
      {
        id: '2026-08-10-completed',
        label: 'Aug 10',
        value: 4,
        cohort: { cohort: 'completed', bucket: '2026-08-10' },
      },
      {
        id: '2026-08-11-completed',
        label: 'Aug 11',
        value: 7,
        cohort: { cohort: 'completed', bucket: '2026-08-11' },
      },
    ],
  },
  {
    id: 'created',
    label: 'Created',
    points: [
      {
        id: '2026-08-10-created',
        label: 'Aug 10',
        value: 6,
        cohort: { cohort: 'created', bucket: '2026-08-10' },
      },
      {
        id: '2026-08-11-created',
        label: 'Aug 11',
        value: 3,
        cohort: { cohort: 'created', bucket: '2026-08-11' },
      },
    ],
  },
] as const;

describe('LinePlot', () => {
  test('exposes the same exact point to pointer and keyboard users', async () => {
    const activate = mock();
    const user = userEvent.setup();
    render(<LinePlot label="Delivery trend" onActivate={activate} series={series} />);

    await user.hover(screen.getByTestId('plot-hit-2026-08-11-completed'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 7');

    const plot = screen.getByRole('application', { name: 'Delivery trend' });
    await user.tab();
    expect(plot).toHaveFocus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(activate).toHaveBeenLastCalledWith({
      cohort: 'completed',
      bucket: '2026-08-11',
    });

    await user.keyboard('{ArrowDown}{Enter}');
    expect(activate).toHaveBeenLastCalledWith({ cohort: 'created', bucket: '2026-08-11' });
    expect(screen.getByText('Created 3')).toBeVisible();
  });

  test('supports Home, End, Escape, and linked table activation', async () => {
    const activate = mock();
    const user = userEvent.setup();
    render(<LinePlot label="Delivery trend" onActivate={activate} series={series} />);

    const plot = screen.getByRole('application', { name: 'Delivery trend' });
    await user.tab();
    expect(plot).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 10');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.click(screen.getByText('View data (4 rows)'));
    await user.click(screen.getByRole('button', { name: 'Aug 11, Completed 7' }));
    expect(activate).toHaveBeenLastCalledWith({
      cohort: 'completed',
      bucket: '2026-08-11',
    });
    expect(screen.getByTestId('plot-hit-2026-08-11-completed')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('supports exact hover and keyboard inspection without issue activation', async () => {
    const user = userEvent.setup();
    render(<LinePlot label="Sprint burn" series={series} />);

    await user.hover(screen.getByTestId('plot-hit-2026-08-11-completed'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 7');

    await user.tab();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 7');
    expect(screen.queryByRole('button', { name: 'Aug 11, Completed 7' })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Aug 11 Completed 7/, hidden: true })).not.toBeVisible();
    await user.click(screen.getByText('View data (4 rows)'));
    expect(screen.getByRole('row', { name: /Aug 11 Completed 7/ })).toBeVisible();
  });

  test('keeps keyboard position across evidence focus and clears pointer-only hover', async () => {
    const user = userEvent.setup();
    render(<LinePlot label="Delivery trend" onActivate={mock()} series={series} />);

    const plot = screen.getByRole('application', { name: 'Delivery trend' });
    await user.tab();
    expect(plot).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');

    await user.hover(screen.getByTestId('plot-hit-2026-08-10-created'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Created 6');
    await user.unhover(screen.getByRole('application', { name: 'Delivery trend' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('aligns series on an explicit shared numeric domain', () => {
    render(
      <LinePlot
        label="Working day comparison"
        series={[
          {
            id: 'current',
            label: 'Current',
            points: [
              { ...series[0].points[0], id: 'current-1', x: 1 },
              { ...series[0].points[1], id: 'current-2', x: 2 },
            ],
          },
          {
            id: 'previous',
            label: 'Previous',
            points: [
              { ...series[1].points[0], id: 'previous-1', x: 1 },
              { ...series[1].points[1], id: 'previous-2', x: 2 },
              { ...series[1].points[0], id: 'previous-3', x: 3 },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByTestId('plot-hit-current-2')).toHaveAttribute(
      'cx',
      screen.getByTestId('plot-hit-previous-2').getAttribute('cx'),
    );
    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 10');
  });

  test('adds chart guidance without shrinking pointer targets', async () => {
    const user = userEvent.setup();
    render(
      <LinePlot
        label="Delivery trend"
        series={series}
        xAxisLabel="Calendar date"
        yAxisLabel="Issues completed"
      />,
    );

    expect(screen.getAllByTestId('plot-grid-line')).toHaveLength(5);
    expect(screen.getByTestId('plot-y-max')).toHaveTextContent('7');
    expect(screen.getByTestId('plot-x-start')).toHaveTextContent('Aug 10');
    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 11');
    expect(screen.getByTestId('plot-x-axis-label')).toHaveTextContent('Calendar date');
    expect(screen.getByTestId('plot-y-axis-label')).toHaveTextContent('Issues completed');
    expect(screen.getByTestId('plot-y-axis-label').getAttribute('fill')).toBe('var(--color-muted)');
    expect(screen.getByTestId('plot-y-max').getAttribute('fill')).toBe('var(--color-faint)');
    expect(screen.getByTestId('plot-y-zero')).toHaveTextContent('0');
    expect(screen.getByTestId('plot-point-2026-08-11-completed')).toHaveAttribute('r', '3');
    expect(screen.getByTestId('plot-hit-2026-08-11-completed')).toHaveAttribute('r', '10');
    expect(screen.getByTestId('plot-legend-completed')).not.toHaveAttribute('stroke-dasharray');

    await user.hover(screen.getByTestId('plot-hit-2026-08-11-completed'));
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '97.5%' });
  });

  test('shows dashed legend keys and short calendar ticks', () => {
    render(
      <LinePlot
        label="Sprint burn"
        series={[
          {
            id: 'scope',
            label: 'Scope',
            dashed: true,
            points: [
              {
                ...series[0].points[0],
                id: 'scope-1',
                label: '2026-08-11',
              },
              {
                ...series[0].points[1],
                id: 'scope-2',
                label: '2026-08-24',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByTestId('plot-legend-scope')).toHaveAttribute('stroke-dasharray', '5 3');
    expect(screen.getByTestId('plot-x-start')).toHaveTextContent('Aug 11');
    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 24');
  });

  test('lets a series pin an explicit color token instead of taking its array position', () => {
    render(
      <LinePlot
        label="Sprint burn"
        series={[
          { ...series[0], id: 'remaining', label: 'Remaining', color: 1 },
          { ...series[1], id: 'scope', label: 'Scope', color: 4 },
          {
            ...series[0],
            id: 'ideal',
            label: 'Ideal',
            points: series[0].points.map((point) => ({ ...point, id: `ideal-${point.id}` })),
          },
        ]}
      />,
    );

    expect(screen.getByTestId('plot-line-remaining')).toHaveAttribute(
      'stroke',
      'var(--analytics-series-1)',
    );
    expect(screen.getByTestId('plot-line-scope')).toHaveAttribute(
      'stroke',
      'var(--analytics-series-4)',
    );
    expect(screen.getByTestId('plot-legend-scope')).toHaveAttribute(
      'stroke',
      'var(--analytics-series-4)',
    );
    expect(screen.getByTestId('plot-line-ideal')).toHaveAttribute(
      'stroke',
      'var(--analytics-series-3)',
    );
  });

  test('leaves unavailable history as a visible gap instead of drawing false zeroes', () => {
    render(
      <LinePlot
        label="Sprint burn"
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: [
              { ...series[0].points[0], id: 'missing-1', value: 0, available: false },
              { ...series[0].points[1], id: 'missing-2', value: 0, available: false },
              { ...series[0].points[0], id: 'known-1', value: 9 },
              { ...series[0].points[1], id: 'known-2', value: 7 },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByTestId('plot-point-missing-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plot-point-missing-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('plot-line-remaining').getAttribute('d')).not.toContain(' 236.00');
    expect(screen.getByText('2 dates unavailable')).toBeVisible();
  });

  test('lands End on the last available point, not the first, when trailing points are unavailable', async () => {
    const user = userEvent.setup();
    render(
      <LinePlot
        label="Sprint burn"
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: [
              { ...series[0].points[0], id: 'known-1', value: 9 },
              { ...series[0].points[1], id: 'known-2', value: 7 },
              { ...series[0].points[0], id: 'missing-1', label: 'Aug 12', available: false },
              { ...series[0].points[1], id: 'missing-2', label: 'Aug 13', available: false },
            ],
          },
        ]}
      />,
    );

    const plot = screen.getByRole('application', { name: 'Sprint burn' });
    await user.tab();
    expect(plot).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');
  });

  test('keeps ArrowRight at the last available point instead of wrapping to the first', async () => {
    const user = userEvent.setup();
    render(
      <LinePlot
        label="Sprint burn"
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: [
              { ...series[0].points[0], id: 'known-1', value: 9 },
              { ...series[0].points[1], id: 'known-2', value: 7 },
              { ...series[0].points[0], id: 'missing-1', label: 'Aug 12', available: false },
              { ...series[0].points[1], id: 'missing-2', label: 'Aug 13', available: false },
            ],
          },
        ]}
      />,
    );

    const plot = screen.getByRole('application', { name: 'Sprint burn' });
    await user.tab();
    expect(plot).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 11');
  });

  test('renders one slot per sprint day with weekend bands and a full-day tooltip', async () => {
    const user = userEvent.setup();
    const days = [
      { date: '2026-08-13', weekend: false, today: false, future: false },
      { date: '2026-08-14', weekend: false, today: true, future: false },
      { date: '2026-08-15', weekend: true, today: false, future: true },
      { date: '2026-08-16', weekend: true, today: false, future: true },
      { date: '2026-08-17', weekend: false, today: false, future: true },
    ];
    render(
      <LinePlot
        days={days}
        label="Burn"
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: [
              { id: 'r1', label: '2026-08-13', value: 8, cohort: { cohort: 'open' } },
              { id: 'r2', label: '2026-08-14', value: 7, cohort: { cohort: 'open' } },
            ],
          },
          {
            id: 'ideal',
            label: 'Ideal',
            dashed: true,
            dots: true,
            points: days.map((day, index) => ({
              id: `i${index}`,
              label: day.date,
              value: 8 - index,
              cohort: { cohort: 'open' },
            })),
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId('plot-weekend-band')).toHaveLength(2);
    expect(screen.getAllByTestId('plot-day-hit')).toHaveLength(5);
    await user.hover(screen.getAllByTestId('plot-day-hit')[1] as Element);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Remaining 7');
    expect(tooltip).toHaveTextContent('Ideal 7');
  });

  test('renders the svg at the measured width instead of stretching a viewBox', () => {
    render(
      <LinePlot
        label="Burn"
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: [{ id: 'r1', label: '2026-08-13', value: 8, cohort: { cohort: 'open' } }],
          },
        ]}
      />,
    );
    const svg = screen.getByRole('application');
    expect(svg.getAttribute('viewBox')).toBeNull();
    expect(svg.getAttribute('width')).toBe('640');
  });

  test('pivots one table row per sprint day with series columns, activation, and the active marker', async () => {
    const user = userEvent.setup();
    const activate = mock();
    const days = [
      { date: '2026-08-13', weekend: false, today: false, future: false },
      { date: '2026-08-14', weekend: false, today: true, future: false },
      { date: '2026-08-15', weekend: true, today: false, future: true },
      { date: '2026-08-16', weekend: true, today: false, future: true },
      { date: '2026-08-17', weekend: false, today: false, future: true },
    ];
    render(
      <LinePlot
        days={days}
        label="Burn"
        onActivate={activate}
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: days.map((day, index) => ({
              id: `r${index}`,
              label: day.date,
              value: 8 - index,
              cohort: { cohort: 'open', bucket: day.date },
            })),
          },
          {
            id: 'ideal',
            label: 'Ideal',
            dashed: true,
            points: days.map((day, index) => ({
              id: `i${index}`,
              label: day.date,
              value: 8 - index,
              cohort: { cohort: 'open', bucket: `ideal-${day.date}` },
            })),
          },
        ]}
      />,
    );

    await user.click(screen.getByText('View data (5 rows)'));

    expect(screen.getByRole('columnheader', { name: 'Remaining' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Ideal' })).toBeVisible();

    await user.hover(screen.getAllByTestId('plot-day-hit')[1] as Element);
    const activeRow = screen.getByRole('row', { name: /Aug 14/ });
    expect(activeRow).toHaveAttribute('data-active', 'true');

    await user.click(screen.getByRole('button', { name: /Aug 14/ }));
    expect(activate).toHaveBeenLastCalledWith({ cohort: 'open', bucket: '2026-08-14' });
  });

  test('supports day-mode keyboard navigation, activation, and escape', async () => {
    const user = userEvent.setup();
    const activate = mock();
    const days = [
      { date: '2026-08-13', weekend: false, today: false, future: false },
      { date: '2026-08-14', weekend: false, today: false, future: false },
      { date: '2026-08-15', weekend: true, today: false, future: false },
      { date: '2026-08-16', weekend: true, today: false, future: false },
      { date: '2026-08-17', weekend: false, today: false, future: false },
    ];
    render(
      <LinePlot
        days={days}
        label="Burn"
        onActivate={activate}
        series={[
          {
            id: 'remaining',
            label: 'Remaining',
            points: days.map((day, index) => ({
              id: `r${index}`,
              label: day.date,
              value: 8 - index,
              cohort: { cohort: 'open', bucket: day.date },
            })),
          },
        ]}
      />,
    );

    const plot = screen.getByRole('application', { name: 'Burn' });
    await user.tab();
    expect(plot).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 13');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 14');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 15');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 13');
    await user.keyboard('{End}');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Aug 17');

    await user.keyboard('{Enter}');
    expect(activate).toHaveBeenLastCalledWith({ cohort: 'open', bucket: '2026-08-17' });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('draws a staircase path for a step series and a straight line without it', () => {
    const days = [
      { date: '2026-08-13', weekend: false, today: false, future: false },
      { date: '2026-08-14', weekend: false, today: false, future: false },
      { date: '2026-08-15', weekend: false, today: false, future: false },
    ];
    const points = days.map((day, index) => ({
      id: `s${index}`,
      label: day.date,
      value: index + 1,
      cohort: { cohort: 'open' as const },
    }));

    const { rerender } = render(
      <LinePlot
        days={days}
        label="Scope"
        series={[{ id: 'scope', label: 'Scope', points, step: true }]}
      />,
    );
    const stepPath = screen.getByTestId('plot-line-scope').getAttribute('d');
    expect(stepPath).toContain('H');
    expect(stepPath).toContain('V');
    expect(stepPath).not.toContain('L');

    rerender(
      <LinePlot days={days} label="Scope" series={[{ id: 'scope', label: 'Scope', points }]} />,
    );
    const linePath = screen.getByTestId('plot-line-scope').getAttribute('d');
    expect(linePath).toContain('L');
    expect(linePath).not.toContain('H');
    expect(linePath).not.toContain('V');
  });
});
