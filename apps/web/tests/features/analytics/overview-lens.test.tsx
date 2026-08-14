import { afterEach, describe, expect, mock, test } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import type { AnalyticsOverviewResponse } from '../../../src/features/analytics/contracts.ts';
import { OverviewLens } from '../../../src/features/analytics/overview-lens.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const originalFetch = globalThis.fetch;
const asOf = '2026-08-14T10:00:00.000Z';
const data: AnalyticsOverviewResponse = {
  lens: 'overview',
  asOf,
  coverage: { kind: 'live', from: '2026-08-01T00:00:00.000Z', asOf },
  cards: [
    {
      id: 'blocked',
      label: 'Blocked work',
      value: 3,
      unit: 'issues',
      comparisonDelta: 1,
      cohort: { cohort: 'blocked' },
      reconciliation: { kind: 'total', cohortCount: 3 },
    },
  ],
  delivery: [
    {
      date: '2026-08-13',
      created: 5,
      completed: 2,
      open: 11,
      createdCohort: { cohort: 'created', bucket: '2026-08-13' },
      completedCohort: { cohort: 'completed', bucket: '2026-08-13' },
      openCohort: { cohort: 'open', bucket: '2026-08-13' },
    },
    {
      date: '2026-08-14',
      created: 1,
      completed: 4,
      open: 8,
      createdCohort: { cohort: 'created', bucket: '2026-08-14' },
      completedCohort: { cohort: 'completed', bucket: '2026-08-14' },
      openCohort: { cohort: 'open', bucket: '2026-08-14' },
    },
  ],
  state: [
    {
      id: 'started',
      label: 'Started',
      value: 4,
      unit: 'issues',
      cohort: { cohort: 'state-category:started' },
    },
  ],
  projects: [],
  priorities: [],
  outliers: [],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OverviewLens', () => {
  test('opens metric and chart cohorts in exact issue evidence', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            predicate: 'blocked work',
            total: 0,
            totalValue: 0,
            details: { validCycleCount: 0, cycleTimeP50: null, cycleTimeP85: null },
            issues: [],
            nextCursor: null,
            limit: 50,
            asOf,
            from: '2026-08-01T00:00:00.000Z',
            to: '2026-08-15T00:00:00.000Z',
            timezone: 'UTC',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<OverviewLens data={data} query={analyticsQuerySchema.parse({})} />);

    expect(screen.getByRole('application', { name: 'Created and completed work' })).toBeVisible();
    expect(screen.getByRole('application', { name: 'Open work' })).toBeVisible();
    expect(
      screen.queryByRole('application', { name: 'Created, completed, and open work' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId('plot-y-axis-label').map((node) => node.textContent)).toContain(
      'Issues per day',
    );
    expect(screen.getAllByTestId('plot-y-axis-label').map((node) => node.textContent)).toContain(
      'Open issues',
    );

    await user.hover(screen.getByTestId('plot-hit-2026-08-14-completed'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 4');

    await user.click(screen.getByRole('button', { name: 'Blocked work, 3 issues' }));
    expect(await screen.findByRole('dialog', { name: 'Blocked work' })).toBeVisible();
    expect(screen.getByText(/Predicate: blocked work/)).toBeVisible();
  });
});
