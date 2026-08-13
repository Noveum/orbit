import { describe, expect, it } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AnalyticsCockpit } from '../../../src/features/analytics/analytics-cockpit.tsx';
import { analyticsKeys } from '../../../src/features/analytics/analytics-keys.ts';
import type {
  AnalyticsOverviewResponse,
  AnalyticsSprintsResponse,
} from '../../../src/features/analytics/contracts.ts';
import { createQueryClient } from '../../../src/lib/query/provider.tsx';

const asOf = '2026-08-13T12:00:00.000Z';
const overview: AnalyticsOverviewResponse = {
  lens: 'overview',
  asOf,
  coverage: { kind: 'live', from: null, asOf },
  cards: [
    {
      id: 'throughput',
      label: 'Completed',
      value: 18,
      unit: 'issues',
      comparisonDelta: 3,
      cohort: { cohort: 'completed' },
      reconciliation: { kind: 'total', cohortCount: 18 },
    },
  ],
  delivery: [],
  state: [],
  projects: [],
  priorities: [],
  outliers: [],
};

const emptySprints: AnalyticsSprintsResponse = {
  lens: 'sprints',
  selected: null,
  current: null,
  previous: null,
  velocity: [],
  flow: {
    leadTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
    cycleTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
    completed: 0,
    leadTimeCoverage: 'unavailable',
    cycleTimeCoverage: 'unavailable',
  },
  focus: null,
  coverage: { kind: 'live', from: null, asOf },
  formulas: {
    planned: 'Captured at sprint start.',
    scope: 'Membership during the sprint.',
    burn: 'Remaining scope by local day.',
    leadTime: 'Creation to completion.',
    cycleTime: 'Start to completion.',
    points: 'Unestimated work is zero points.',
    coverage: 'Live when no sprint is selected.',
  },
};

function renderCockpit(
  query = analyticsQuerySchema.parse({}),
  response: AnalyticsOverviewResponse | AnalyticsSprintsResponse = overview,
) {
  const client = createQueryClient();
  client.setQueryDefaults(analyticsKeys.root, { enabled: false });
  client.setQueryData(analyticsKeys.lens(query.lens, query), response);
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<AnalyticsCockpit initialQuery={query} />, { wrapper: Wrapper });
}

describe('AnalyticsCockpit', () => {
  it('renders useful hydrated metrics without asking for configuration', () => {
    renderCockpit();

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Reporting range/ })).toHaveTextContent(
      'Active sprint or last 30 days',
    );
    expect(screen.getByText('Completed')).toBeVisible();
    expect(screen.getByText('18')).toBeVisible();
    expect(screen.queryByText('Analytics data is ready.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose a dataset')).not.toBeInTheDocument();
  });

  it('moves between tabs with arrow, Home, and End keys and updates the URL', async () => {
    const user = userEvent.setup();
    renderCockpit();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    overviewTab.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Sprints' })).toHaveFocus();
    expect(window.location.search).toContain('lens=sprints');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'People' })).toHaveFocus();
    expect(window.location.search).toContain('lens=people');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    expect(window.location.search).toBe('');
  });

  it('validates a custom range before applying it and can reset the view', async () => {
    const user = userEvent.setup();
    renderCockpit();

    await user.click(screen.getByRole('button', { name: /Reporting range/ }));
    await user.click(screen.getByRole('button', { name: 'Custom range' }));
    const start = screen.getByLabelText('Start date');
    const end = screen.getByLabelText('End date');
    await user.clear(start);
    await user.type(start, '2026-08-12');
    await user.clear(end);
    await user.type(end, '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));

    expect(screen.getByRole('alert')).toHaveTextContent('End date must be on or after start date');
    expect(window.location.search).toBe('');

    await user.clear(end);
    await user.type(end, '2026-08-13');
    await user.click(screen.getByRole('button', { name: 'Apply range' }));
    expect(window.location.search).toContain('range=custom');
    expect(window.location.search).toContain('from=2026-08-12');

    await user.click(screen.getByRole('button', { name: 'Reset analytics' }));
    expect(window.location.search).toBe('');
  });

  it('renders an honest first-sprint empty state', () => {
    const query = analyticsQuerySchema.parse({ lens: 'sprints' });
    renderCockpit(query, emptySprints);

    expect(screen.getByRole('heading', { name: 'No sprint history yet' })).toBeVisible();
    expect(screen.getByText(/burn and comparison charts will appear/)).toBeVisible();
  });
});
