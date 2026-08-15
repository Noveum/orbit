import { describe, expect, mock, test } from 'bun:test';
import userEvent from '@testing-library/user-event';
import { AnalyticsTabs } from '../../../src/features/analytics/analytics-tabs.tsx';
import { render, screen } from '../../../src/test/render.tsx';

describe('AnalyticsTabs', () => {
  test('renders every lens including Insights, in a stable order', () => {
    render(<AnalyticsTabs onChange={mock()} value="overview" />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Sprints',
      'Projects',
      'People',
      'Insights',
    ]);
  });

  test('selects the Insights tab and calls onChange with the insights lens', async () => {
    const onChange = mock();
    const user = userEvent.setup();
    render(<AnalyticsTabs onChange={onChange} value="overview" />);

    await user.click(screen.getByRole('tab', { name: 'Insights' }));

    expect(onChange).toHaveBeenCalledWith('insights');
  });

  test('End moves keyboard focus to the last tab, which is now Insights', async () => {
    const user = userEvent.setup();
    render(<AnalyticsTabs onChange={mock()} value="overview" />);
    screen.getByRole('tab', { name: 'Overview' }).focus();

    await user.keyboard('{End}');

    expect(screen.getByRole('tab', { name: 'Insights' })).toHaveFocus();
  });
});
