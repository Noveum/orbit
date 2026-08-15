import { describe, expect, test } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import type { AnalyticsSprintsResponse } from '../../../src/features/analytics/contracts.ts';
import { SprintLens } from '../../../src/features/analytics/sprint-lens.tsx';
import { render, screen, within } from '../../../src/test/render.tsx';

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
    future: false,
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
    future: false,
  },
];
const burnDay1 = burn[0];
const burnDay2 = burn[1];
if (burnDay1 === undefined || burnDay2 === undefined) {
  throw new Error('Missing burn fixture.');
}
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
    baseline: { date: '2026-08-13', scope: 9, retroactive: false },
    counterpart: summary,
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

const sprintQueryFixture = analyticsQuerySchema.parse({ lens: 'sprints', measure: 'points' });

function dayOffset(start: string, offset: number): string {
  const value = new Date(`${start}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function isWeekendDate(value: string): boolean {
  const weekday = new Date(`${value}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function buildSprintBurn(options: {
  readonly start: string;
  readonly count: number;
  readonly observedCount: number;
  readonly scope: number;
}) {
  let workingDay = 0;
  return Array.from({ length: options.count }, (_unused, index) => {
    const date = dayOffset(options.start, index);
    const weekend = isWeekendDate(date);
    if (!weekend) workingDay += 1;
    const observed = index < options.observedCount;
    const completed = observed ? index : 0;
    return {
      date,
      calendarDay: index + 1,
      workingDay: weekend ? null : workingDay,
      scope: observed ? options.scope : 0,
      started: observed ? completed : 0,
      completed,
      remaining: observed ? Math.max(0, options.scope - completed) : 0,
      added: 0,
      removed: 0,
      ideal: Math.max(0, options.scope - index),
      available: observed,
      coverage: 'captured' as const,
      future: !observed,
    };
  });
}

const dataWithFutureBurn: AnalyticsSprintsResponse = {
  ...data,
  current:
    data.current === null
      ? null
      : {
          ...data.current,
          burn: buildSprintBurn({ start: '2026-08-13', count: 14, observedCount: 4, scope: 10 }),
        },
};

const dataWithRetroBaseline: AnalyticsSprintsResponse = {
  ...data,
  current:
    data.current === null
      ? null
      : {
          ...data.current,
          baseline: { date: '2026-08-14', scope: 10, retroactive: true },
          burn: [
            { ...burnDay1, available: false, future: false, scope: 0, remaining: 0, ideal: 10 },
            { ...burnDay2, available: true, future: false, scope: 10 },
          ],
        },
};

describe('SprintLens', () => {
  test('frames the whole sprint with weekend bands and a day tooltip', async () => {
    const user = userEvent.setup();
    render(<SprintLens data={dataWithFutureBurn} query={sprintQueryFixture} />);
    expect(screen.getAllByTestId('plot-weekend-band').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByTestId('plot-day-hit')).toHaveLength(14);
    await user.hover(screen.getAllByTestId('plot-day-hit')[3] as Element);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Remaining');
    expect(tooltip).toHaveTextContent('Ideal');
  });

  test('states the capture start once instead of blanking the frame', () => {
    render(<SprintLens data={dataWithRetroBaseline} query={sprintQueryFixture} />);
    expect(screen.getByText(/capture began aug 14/i)).toBeVisible();
    expect(screen.queryByText(/dates unavailable/i)).not.toBeInTheDocument();
  });

  test('shows live burn values, formulas, churn, and honest first-sprint guidance', async () => {
    const user = userEvent.setup();
    render(<SprintLens data={data} query={sprintQueryFixture} />);

    await user.hover(screen.getAllByTestId('plot-day-hit')[1] as Element);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Remaining 7 points');
    expect(screen.getByText('Added').parentElement).toHaveTextContent('Added 2');
    expect(screen.getByText('Removed').parentElement).toHaveTextContent('Removed 1');
    expect(screen.getByText('Initial scope capture is a baseline, not added work.')).toBeVisible();
    expect(screen.getByText('Creation to completion.')).toBeVisible();
    expect(screen.getByText('Start to completion.')).toBeVisible();
    expect(screen.getByText('Lead time p85')).toBeVisible();
    expect(screen.getByText('7d')).toBeVisible();
    expect(screen.getByText('Cycle time p85')).toBeVisible();
    expect(screen.getByText(/velocity below already includes this sprint/i)).toBeVisible();
    expect(screen.getByText(/2 unestimated issues count as 1 point each/i)).toBeVisible();
    const burnFigure = screen
      .getByRole('application', { name: 'Sprint burn down' })
      .closest('figure');
    if (burnFigure === null) throw new Error('missing burn chart figure');
    expect(within(burnFigure).getByTestId('plot-y-axis-label')).toHaveTextContent(
      'Remaining points',
    );
    expect(within(burnFigure).getByTestId('plot-x-axis-label')).toHaveTextContent('Sprint day');
    expect(screen.getByText(/forecast needs at least 3 working days/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Burn up' }));
    await user.hover(screen.getAllByTestId('plot-day-hit')[1] as Element);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed 3');
  });

  test('shows the burn-up Started tooltip and table with the raw started count while the line still plots the stacked height', async () => {
    const user = userEvent.setup();
    render(<SprintLens data={data} query={sprintQueryFixture} />);

    await user.click(screen.getByRole('button', { name: 'Burn up' }));
    await user.hover(screen.getAllByTestId('plot-day-hit')[1] as Element);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Started 6 points');
    expect(tooltip).not.toHaveTextContent('Started 9 points');

    const burnFigure = screen
      .getByRole('application', { name: 'Sprint burn up' })
      .closest('figure');
    if (burnFigure === null) throw new Error('missing burn chart figure');
    await user.click(within(burnFigure).getByText(/View data/));
    expect(within(burnFigure).getByRole('cell', { name: '6 points' })).toBeVisible();

    expect(screen.getByTestId('plot-line-started').getAttribute('d')).toContain('34.40');
  });

  test('shows only the ideal target on a pre-capture day instead of a fabricated zero', async () => {
    const user = userEvent.setup();
    const preCaptureBurn = [
      { ...burnDay1, available: false, future: false, scope: 0, remaining: 0, ideal: 8 },
      { ...burnDay2, available: true, future: false },
    ];
    render(
      <SprintLens
        data={{
          ...data,
          current: data.current === null ? null : { ...data.current, burn: preCaptureBurn },
        }}
        query={sprintQueryFixture}
      />,
    );

    await user.hover(screen.getAllByTestId('plot-day-hit')[0] as Element);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Ideal');
    expect(tooltip).not.toHaveTextContent('Remaining');
    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 14');
  });

  test('keeps the ideal line at zero when the sprint ends on a weekend', async () => {
    const user = userEvent.setup();
    const weekendSprint = {
      ...sprint,
      timezone: 'UTC',
      startsAt: '2026-08-03T00:00:00.000Z',
      endsAt: '2026-08-16T00:00:00.000Z',
    };
    const weekendBurn = [
      { ...burnDay1, date: '2026-08-03', calendarDay: 1, workingDay: 1, ideal: 9, future: false },
      { ...burnDay1, date: '2026-08-13', calendarDay: 11, workingDay: 9, ideal: 1, future: false },
      { ...burnDay1, date: '2026-08-14', calendarDay: 12, workingDay: 10, ideal: 0, future: false },
      {
        ...burnDay1,
        date: '2026-08-15',
        calendarDay: 13,
        workingDay: null,
        ideal: 0,
        future: false,
      },
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
        query={sprintQueryFixture}
      />,
    );

    expect(screen.getByTestId('plot-x-end')).toHaveTextContent('Aug 15');
    const dayHits = screen.getAllByTestId('plot-day-hit');
    await user.hover(dayHits.at(-1) as Element);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Ideal 0 points');
  });

  test('adds a dotted forecast only after a measurable declining trend exists', () => {
    const forecastBurn = [
      {
        ...burnDay1,
        date: '2026-08-11',
        workingDay: 1,
        scope: 12,
        remaining: 10,
        future: false,
      },
      {
        ...burnDay2,
        date: '2026-08-12',
        workingDay: 2,
        scope: 12,
        remaining: 8,
        future: false,
      },
      {
        ...burnDay2,
        date: '2026-08-13',
        workingDay: 3,
        scope: 12,
        remaining: 6,
        future: false,
      },
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

    expect(screen.getByText(/forecasts completion around aug 18, 2026/i)).toBeVisible();
    expect(screen.getByTestId('plot-line-forecast')).toHaveAttribute('stroke-dasharray', '7 5');
    expect(screen.getByTestId('plot-line-scope')).not.toHaveAttribute('stroke-dasharray');
    expect(screen.getByTestId('plot-line-scope').getAttribute('d')).toContain('H');
  });

  test('omits an unearned forecast entirely instead of a blank legend entry and table column', async () => {
    const user = userEvent.setup();
    render(<SprintLens data={data} query={sprintQueryFixture} />);

    expect(screen.getByTestId('plot-line-scope')).toHaveAttribute(
      'stroke',
      'var(--analytics-series-4)',
    );
    expect(screen.queryByTestId('plot-legend-forecast')).not.toBeInTheDocument();

    const burnFigure = screen
      .getByRole('application', { name: 'Sprint burn down' })
      .closest('figure');
    if (burnFigure === null) throw new Error('missing burn chart figure');
    await user.click(within(burnFigure).getByText(/View data/));
    expect(screen.queryByRole('columnheader', { name: 'Forecast' })).not.toBeInTheDocument();
  });

  test('clamps a far forecast to the frame edge with an interpolated value', async () => {
    const user = userEvent.setup();
    const forecastBurn = [
      {
        ...burnDay1,
        date: '2026-08-11',
        workingDay: 1,
        scope: 12,
        remaining: 10,
        ideal: 12,
        future: false,
      },
      {
        ...burnDay2,
        date: '2026-08-12',
        workingDay: 2,
        scope: 12,
        remaining: 8,
        ideal: 9,
        future: false,
      },
      {
        ...burnDay2,
        date: '2026-08-13',
        workingDay: 3,
        scope: 12,
        remaining: 6,
        ideal: 6,
        future: false,
      },
      {
        ...burnDay2,
        date: '2026-08-14',
        workingDay: 4,
        scope: 0,
        remaining: 0,
        ideal: 3,
        available: false,
        future: true,
      },
      {
        ...burnDay2,
        date: '2026-08-15',
        workingDay: null,
        scope: 0,
        remaining: 0,
        ideal: 3,
        available: false,
        future: true,
      },
      {
        ...burnDay2,
        date: '2026-08-16',
        workingDay: null,
        scope: 0,
        remaining: 0,
        ideal: 3,
        available: false,
        future: true,
      },
      {
        ...burnDay2,
        date: '2026-08-17',
        workingDay: 5,
        scope: 0,
        remaining: 0,
        ideal: 0,
        available: false,
        future: true,
      },
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

    expect(screen.getByText(/forecasts completion around aug 18, 2026/i)).toBeVisible();
    expect(screen.getByText('Aug 18, 2026 · 1 day late')).toBeVisible();

    const dayHits = screen.getAllByTestId('plot-day-hit');
    expect(dayHits).toHaveLength(7);
    await user.hover(dayHits.at(-1) as Element);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Forecast 1.2 points');
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

  test('frames the focus card across the whole sprint with an ideal series', () => {
    const focusBurn = buildSprintBurn({
      start: '2026-08-13',
      count: 8,
      observedCount: 5,
      scope: 6,
    });
    render(
      <SprintLens
        data={{
          ...data,
          focus: {
            personId: '00000000-0000-7000-8000-000000000009',
            name: 'Ada',
            burn: focusBurn,
            summary,
            coverage: { kind: 'captured', from: sprint.startsAt, asOf },
          },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    const focusChart = screen.getByRole('application', { name: 'Ada remaining work' });
    expect(within(focusChart).getAllByTestId('plot-day-hit')).toHaveLength(focusBurn.length);
    expect(screen.getByTestId('plot-line-ideal-person')).toBeInTheDocument();
  });

  test('states the capture start on the focus card instead of a dates-unavailable fallback', () => {
    const focusBurn = [
      { ...burnDay1, available: false, future: false, scope: 0, remaining: 0, ideal: 8 },
      { ...burnDay2, available: true, future: false },
    ];
    render(
      <SprintLens
        data={{
          ...data,
          focus: {
            personId: '00000000-0000-7000-8000-000000000009',
            name: 'Ada',
            burn: focusBurn,
            summary,
            coverage: { kind: 'captured', from: sprint.startsAt, asOf },
          },
        }}
        query={analyticsQuerySchema.parse({ lens: 'sprints' })}
      />,
    );

    expect(screen.getByText(/capture began aug 14/i)).toBeVisible();
    expect(screen.queryByText(/dates unavailable/i)).not.toBeInTheDocument();
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

  test('pairs planned against completed velocity per closed sprint, averages them, and appends the current sprint as an in-progress pair', async () => {
    const user = userEvent.setup();
    const closedSprintOne = {
      ...sprint,
      id: '00000000-0000-7000-8000-000000000002',
      name: 'Sprint 2',
      number: 2,
    };
    const closedSprintTwo = {
      ...sprint,
      id: '00000000-0000-7000-8000-000000000003',
      name: 'Sprint 3',
      number: 3,
    };
    render(
      <SprintLens
        data={{
          ...data,
          velocity: [
            {
              sprint: closedSprintOne,
              planned: 10,
              completed: 8,
              carryover: 1,
              coverage: 'captured',
            },
            {
              sprint: closedSprintTwo,
              planned: 12,
              completed: 10,
              carryover: 0,
              coverage: 'captured',
            },
          ],
        }}
        query={sprintQueryFixture}
      />,
    );

    expect(screen.getByTestId(`plot-category-${closedSprintOne.id}`)).toHaveTextContent('Sprint 2');
    expect(screen.getByTestId(`plot-bar-primary-${closedSprintOne.id}`).getAttribute('fill')).toBe(
      'var(--analytics-series-1)',
    );
    expect(
      screen.getByTestId(`plot-bar-secondary-${closedSprintOne.id}`).getAttribute('fill'),
    ).toBe('var(--color-border-strong)');

    await user.hover(screen.getByTestId(`plot-bar-primary-${closedSprintOne.id}`));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Completed');
    expect(screen.getByRole('tooltip')).toHaveTextContent('8 points');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Planned');
    expect(screen.getByRole('tooltip')).toHaveTextContent('10 points');

    expect(screen.getByTestId('plot-average-line')).toBeInTheDocument();
    expect(screen.getByText('Avg 9')).toBeVisible();

    expect(screen.getByTestId('plot-pair-current')).toBeInTheDocument();
    expect(screen.getByTestId('plot-category-current')).toHaveTextContent('Sprint 1');
    expect(screen.getByTestId('plot-bar-primary-current')).toBeInTheDocument();
    expect(screen.getByTestId('plot-bar-secondary-current')).toBeInTheDocument();
    expect(screen.getByTestId('plot-bar-primary-current').getAttribute('fill-opacity')).toBe(
      '0.45',
    );
    expect(
      screen.getByTestId(`plot-bar-primary-${closedSprintOne.id}`).getAttribute('fill-opacity'),
    ).toBeNull();

    expect(
      screen.queryByText('Velocity history builds as sprints complete.'),
    ).not.toBeInTheDocument();
  });

  test('captions the velocity chart until any sprint has closed', () => {
    render(<SprintLens data={data} query={sprintQueryFixture} />);

    expect(screen.getByTestId('plot-pair-current')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-average-line')).not.toBeInTheDocument();
    expect(screen.getByText('Velocity history builds as sprints complete.')).toBeVisible();
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
