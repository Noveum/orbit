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
});
