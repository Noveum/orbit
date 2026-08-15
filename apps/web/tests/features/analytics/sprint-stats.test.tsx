import { describe, expect, test } from 'bun:test';
import type { AnalyticsSprintsResponse } from '../../../src/features/analytics/contracts.ts';
import { SprintStats } from '../../../src/features/analytics/sprint-stats.tsx';
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
  planned: 20,
  currentScope: 21,
  completed: 10,
  remaining: 11,
  added: 2,
  removed: 1,
  carryover: 0,
  unestimated: 0,
};
const counterpart = {
  planned: 50,
  currentScope: 55,
  completed: 24,
  remaining: 31,
  added: 5,
  removed: 2,
  carryover: 0,
  unestimated: 0,
};

const observedDay1 = {
  date: '2026-08-03',
  calendarDay: 1,
  workingDay: 1,
  scope: 20,
  started: 2,
  completed: 0,
  remaining: 20,
  added: 0,
  removed: 0,
  ideal: 20,
  available: true,
  coverage: 'captured' as const,
  future: false,
};
const observedDay2 = {
  date: '2026-08-04',
  calendarDay: 2,
  workingDay: 2,
  scope: 20,
  started: 5,
  completed: 2,
  remaining: 18,
  added: 0,
  removed: 0,
  ideal: 15,
  available: true,
  coverage: 'captured' as const,
  future: false,
};
const observedDay3 = {
  date: '2026-08-05',
  calendarDay: 3,
  workingDay: 3,
  scope: 22,
  started: 9,
  completed: 6,
  remaining: 16,
  added: 2,
  removed: 0,
  ideal: 10,
  available: true,
  coverage: 'captured' as const,
  future: false,
};
const observedDay4 = {
  date: '2026-08-06',
  calendarDay: 4,
  workingDay: 4,
  scope: 21,
  started: 12,
  completed: 10,
  remaining: 11,
  added: 0,
  removed: 1,
  ideal: 5,
  available: true,
  coverage: 'live' as const,
  future: false,
};
const futurePoint = (date: string, calendarDay: number, workingDay: number | null) => ({
  date,
  calendarDay,
  workingDay,
  scope: 0,
  started: 0,
  completed: 0,
  remaining: 0,
  added: 0,
  removed: 0,
  ideal: 0,
  available: false,
  coverage: 'live' as const,
  future: true,
});

const burn = [
  observedDay1,
  observedDay2,
  observedDay3,
  observedDay4,
  futurePoint('2026-08-07', 5, 5),
];

const sprint = {
  id: '00000000-0000-7000-8000-000000000001',
  name: 'Sprint 1',
  number: 1,
  teamId: null,
  timezone: 'UTC',
  startsAt: '2026-08-03T00:00:00.000Z',
  endsAt: '2026-08-08T00:00:00.000Z',
  completedAt: null,
  archivedAt: null,
};
const person = {
  personId: '00000000-0000-7000-8000-000000000009',
  name: 'Ada',
  burn,
  summary,
  coverage: { kind: 'captured' as const, from: sprint.startsAt, asOf },
};
const current: NonNullable<AnalyticsSprintsResponse['current']> = {
  sprint,
  measure: 'issues',
  summary,
  baseline: { date: '2026-08-03', scope: 20, retroactive: false },
  counterpart,
  scopeChanges: { added: 2, removed: 1 },
  burn,
  cohorts: { planned: [], added: [], removed: [], completed: [], incomplete: [], carryover: [] },
  teams: [],
  people: Array.from({ length: 9 }, (_, index) => ({
    ...person,
    personId: `00000000-0000-7000-8000-00000000000${index}`,
    name: `Person ${index}`,
  })),
  flow,
  coverage: { kind: 'captured', from: sprint.startsAt, asOf },
};

describe('SprintStats', () => {
  test('renders both measures in scope, computed percentages, pace, people, and a late forecast', () => {
    render(<SprintStats current={current} measure="issues" />);

    expect(screen.getByText('Scope')).toHaveTextContent('Scope 21 issues · 55 pts');
    expect(screen.getByText('Completed')).toHaveTextContent('Completed 10 (48%)');
    expect(screen.getByText('Started')).toHaveTextContent('Started 12 (57%)');
    expect(screen.getByText('Remaining')).toHaveTextContent('Remaining 11');
    expect(screen.getByText('Churn')).toHaveTextContent('Churn +2 added · 1 removed');
    expect(screen.getByText('Pace')).toHaveTextContent('Pace needed 5.5/d · actual 2.5/d');
    expect(screen.getByText('People')).toHaveTextContent('People 9 people');

    const forecastValue = screen.getByText('Aug 13, 2026 · 6 days late');
    expect(forecastValue).toHaveClass('text-warning');
  });

  test('shows an on-track forecast in the accent color when it lands inside the sprint', () => {
    const onTrackBurn = [
      observedDay1,
      observedDay2,
      observedDay3,
      observedDay4,
      futurePoint('2026-08-07', 5, 5),
      futurePoint('2026-08-10', 6, 6),
      futurePoint('2026-08-11', 7, 7),
      futurePoint('2026-08-12', 8, 8),
      futurePoint('2026-08-13', 9, 9),
    ];
    render(<SprintStats current={{ ...current, burn: onTrackBurn }} measure="issues" />);

    const forecastValue = screen.getByText('Aug 13, 2026 · on track');
    expect(forecastValue).toHaveClass('text-accent');
  });

  test('shows the pace fallback and forecast fallback when history is insufficient', () => {
    const sparseBurn = [futurePoint('2026-08-07', 5, 5)];
    render(<SprintStats current={{ ...current, burn: sparseBurn }} measure="issues" />);

    expect(screen.getByText('Pace')).toHaveTextContent('Pace Not enough data');
    expect(screen.getByText('Forecast')).toHaveTextContent('Forecast needs 3 working days');
  });

  test('uses singular day wording for a forecast that lands exactly one day late', () => {
    const oneDayLateBurn = [
      observedDay1,
      observedDay2,
      observedDay3,
      observedDay4,
      futurePoint('2026-08-07', 5, 5),
      futurePoint('2026-08-10', 6, 6),
      futurePoint('2026-08-11', 7, 7),
      futurePoint('2026-08-12', 8, 8),
    ];
    render(<SprintStats current={{ ...current, burn: oneDayLateBurn }} measure="issues" />);

    const forecastValue = screen.getByText('Aug 13, 2026 · 1 day late');
    expect(forecastValue).toHaveClass('text-warning');
  });
});
