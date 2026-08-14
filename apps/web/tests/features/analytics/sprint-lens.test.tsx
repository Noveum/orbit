import { describe, expect, test } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import type { AnalyticsSprintsResponse } from '../../../src/features/analytics/contracts.ts';
import { SprintLens } from '../../../src/features/analytics/sprint-lens.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const asOf = '2026-08-14T10:00:00.000Z';
const flow = {
  leadTime: { count: 3, p50: 4, p85: 7, min: 2, max: 8, average: 4.5 },
  cycleTime: { count: 3, p50: 2, p85: 3, min: 1, max: 4, average: 2.2 },
  completed: 3,
  leadTimeCoverage: 'current-row' as const,
  cycleTimeCoverage: 'current-column' as const,
};
const summary = {
  planned: 8,
  currentScope: 10,
  completed: 3,
  remaining: 7,
  added: 2,
  removed: 1,
  carryover: 0,
  unestimated: 2,
};
const burn = [
  {
    date: '2026-08-13',
    calendarDay: 1,
    workingDay: 1,
    scope: 9,
    started: 3,
    completed: 1,
    remaining: 8,
    added: 1,
    removed: 0,
    ideal: 8,
    available: true,
    coverage: 'captured' as const,
  },
  {
    date: '2026-08-14',
    calendarDay: 2,
    workingDay: 2,
    scope: 10,
    started: 6,
    completed: 3,
    remaining: 7,
    added: 2,
    removed: 1,
    ideal: 7,
    available: true,
    coverage: 'live' as const,
  },
];
const sprint = {
  id: '00000000-0000-7000-8000-000000000001',
  name: 'Sprint 1',
  number: 1,
  teamId: null,
  timezone: 'Asia/Kolkata',
  startsAt: '2026-08-13T00:00:00.000Z',
  endsAt: '2026-08-27T00:00:00.000Z',
  completedAt: null,
  archivedAt: null,
};
const data: AnalyticsSprintsResponse = {
  lens: 'sprints',
  selected: sprint,
  current: {
    sprint,
    measure: 'points',
    summary,
    scopeChanges: { added: 2, removed: 1 },
    burn,
    cohorts: { planned: [], added: [], removed: [], completed: [], incomplete: [], carryover: [] },
    teams: [],
    people: [],
    flow,
    coverage: { kind: 'captured', from: sprint.startsAt, asOf },
  },
  previous: null,
  velocity: [],
  flow,
  focus: null,
  coverage: { kind: 'captured', from: sprint.startsAt, asOf },
  formulas: {
    planned: 'Captured membership at the sprint planning cutoff.',
    scope: 'Membership during the sprint.',
    burn: 'Remaining scope combines snapshots with live facts through today.',
    leadTime: 'Creation to completion.',
    cycleTime: 'Start to completion.',
    points: 'Unestimated work contributes zero points.',
    coverage: 'Captured membership with live current-day flow.',
  },
};

describe('SprintLens', () => {
  test('shows live burn values, formulas, churn, and honest first-sprint guidance', async () => {
    const user = userEvent.setup();
    render(
      <SprintLens
        data={data}
        query={analyticsQuerySchema.parse({ lens: 'sprints', measure: 'points' })}
      />,
    );

    await user.hover(screen.getByTestId('plot-hit-2026-08-14-remaining'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Remaining 7 points');
    expect(screen.getByText('Added').parentElement).toHaveTextContent('Added 2');
    expect(screen.getByText('Removed').parentElement).toHaveTextContent('Removed 1');
    expect(screen.getByText('Initial scope capture is a baseline, not added work.')).toBeVisible();
    expect(screen.getByText('Creation to completion.')).toBeVisible();
    expect(screen.getByText('Start to completion.')).toBeVisible();
    expect(screen.getByText('Lead time p85')).toBeVisible();
    expect(screen.getByText('7d')).toBeVisible();
    expect(screen.getByText('Cycle time p85')).toBeVisible();
    expect(screen.getByText(/comparison will appear after this sprint closes/i)).toBeVisible();
    expect(screen.getByText(/2 unestimated issues contribute zero points/i)).toBeVisible();
    expect(screen.getByTestId('plot-y-axis-label')).toHaveTextContent('Remaining points');
    expect(screen.getByTestId('plot-x-axis-label')).toHaveTextContent('Sprint working day');
    expect(screen.getByText(/forecast needs at least 3 working days/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Burn up' }));
    await user.hover(screen.getByTestId('plot-hit-2026-08-14-completed'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 3');
  });

  test('does not draw pre-capture dates as zero and explains when tracking began', () => {
    const firstBurnPoint = burn[0];
    const secondBurnPoint = burn[1];
    if (firstBurnPoint === undefined || secondBurnPoint === undefined) {
      throw new Error('Missing burn fixture.');
    }
    const observedBurn = [
      { ...firstBurnPoint, date: '2026-08-11', scope: 0, remaining: 0, ideal: 0, available: false },
      { ...firstBurnPoint, date: '2026-08-12', scope: 0, remaining: 0, ideal: 0, available: false },
      { ...firstBurnPoint, date: '2026-08-13', scope: 0, remaining: 0, ideal: 0, available: false },
      {
        ...secondBurnPoint,
        date: '2026-08-14',
        scope: 194,
        remaining: 178,
        ideal: 194,
        available: true,
      },
    ];
    render(
      <SprintLens
        data={{
          ...data,
          current: data.current === null ? null : { ...data.current, burn: observedBurn },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    expect(screen.getByText(/tracking began aug 14, 2026/i)).toBeVisible();
    expect(screen.getByText(/second reliable day is needed/i)).toBeVisible();
    expect(
      screen.getByText(/ideal line starts at the first reliable scope baseline/i),
    ).toBeVisible();
    expect(screen.queryByTestId('plot-point-2026-08-11-remaining')).not.toBeInTheDocument();
    expect(screen.getByTestId('plot-point-2026-08-14-remaining')).toBeInTheDocument();
    expect(screen.getByTestId('plot-point-sprint-end-ideal')).toBeInTheDocument();
    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 27');
  });

  test('keeps the ideal line at zero when the sprint ends on a weekend', async () => {
    const user = userEvent.setup();
    const weekendSprint = {
      ...sprint,
      timezone: 'UTC',
      startsAt: '2026-08-03T00:00:00.000Z',
      endsAt: '2026-08-16T00:00:00.000Z',
    };
    const template = burn[0];
    if (template === undefined) throw new Error('Missing burn fixture.');
    const weekendBurn = [
      { ...template, date: '2026-08-03', calendarDay: 1, workingDay: 1, ideal: 9 },
      { ...template, date: '2026-08-13', calendarDay: 11, workingDay: 9, ideal: 1 },
      { ...template, date: '2026-08-14', calendarDay: 12, workingDay: 10, ideal: 0 },
      { ...template, date: '2026-08-15', calendarDay: 13, workingDay: null, ideal: 0 },
    ];
    render(
      <SprintLens
        data={{
          ...data,
          selected: weekendSprint,
          current:
            data.current === null
              ? null
              : { ...data.current, sprint: weekendSprint, burn: weekendBurn },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints', measure: 'points' })}
      />,
    );

    expect(screen.queryByTestId('plot-point-sprint-end-ideal')).not.toBeInTheDocument();
    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 15');
    await user.hover(screen.getByTestId('plot-hit-2026-08-15-ideal'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Ideal 0 points');
  });

  test('adds a dotted forecast only after a measurable declining trend exists', () => {
    const firstBurnPoint = burn[0];
    const secondBurnPoint = burn[1];
    if (firstBurnPoint === undefined || secondBurnPoint === undefined) {
      throw new Error('Missing burn fixture.');
    }
    const forecastBurn = [
      { ...firstBurnPoint, date: '2026-08-11', workingDay: 1, scope: 12, remaining: 10 },
      { ...secondBurnPoint, date: '2026-08-12', workingDay: 2, scope: 12, remaining: 8 },
      { ...secondBurnPoint, date: '2026-08-13', workingDay: 3, scope: 12, remaining: 6 },
    ];
    render(
      <SprintLens
        data={{
          ...data,
          current: data.current === null ? null : { ...data.current, burn: forecastBurn },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    expect(screen.getByText(/forecasts completion around working day 6/i)).toBeVisible();
    expect(screen.getByTestId('plot-line-forecast')).toHaveAttribute('stroke-dasharray', '7 5');
    expect(screen.getByTestId('plot-line-scope')).toHaveAttribute('stroke-dasharray', '7 5');
  });

  test('does not invent velocity before any sprint exists', () => {
    render(
      <SprintLens
        data={{ ...data, selected: null, current: null }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No sprint history yet' })).toBeVisible();
    expect(screen.queryByText('Sprint 2')).not.toBeInTheDocument();
  });

  test('makes the current user burn prominent without configuration', () => {
    render(
      <SprintLens
        data={{
          ...data,
          focus: {
            personId: '00000000-0000-7000-8000-000000000009',
            name: 'Ada',
            burn,
            summary,
            coverage: { kind: 'captured', from: sprint.startsAt, asOf },
          },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    expect(screen.getByText('My sprint burn')).toBeVisible();
    expect(screen.getByRole('application', { name: 'Ada remaining work' })).toBeVisible();
  });

  test('labels an explicitly selected developer without calling them the current user', () => {
    const personId = '00000000-0000-7000-8000-000000000009';
    render(
      <SprintLens
        data={{
          ...data,
          focus: {
            personId,
            name: 'Ada',
            burn,
            summary,
            coverage: { kind: 'captured', from: sprint.startsAt, asOf },
          },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints', focus: { personId } })}
      />,
    );

    expect(screen.getByText('Selected person sprint burn')).toBeVisible();
    expect(screen.queryByText('My sprint burn')).not.toBeInTheDocument();
    expect(screen.getByText(/assigned to Ada over this sprint/i)).toBeVisible();
    expect(screen.queryByText(/assigned to you/i)).not.toBeInTheDocument();
  });

  test('shows unavailable flow honestly and explains a closed first sprint', () => {
    render(
      <SprintLens
        data={{
          ...data,
          selected: { ...sprint, completedAt: '2026-08-27T00:00:00.000Z' },
          current:
            data.current === null
              ? null
              : {
                  ...data.current,
                  sprint: { ...sprint, completedAt: '2026-08-27T00:00:00.000Z' },
                  flow: {
                    ...flow,
                    leadTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
                    cycleTime: { count: 0, p50: 0, p85: 0, min: 0, max: 0, average: 0 },
                    completed: 0,
                    leadTimeCoverage: 'unavailable',
                    cycleTimeCoverage: 'unavailable',
                  },
                },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/no earlier sprint is available for comparison/i)).toBeVisible();
  });
});
