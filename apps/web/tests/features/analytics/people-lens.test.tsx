import { describe, expect, mock, test } from 'bun:test';
import { analyticsQuerySchema } from '@orbit/shared/validators';
import userEvent from '@testing-library/user-event';
import type { AnalyticsPeopleResponse } from '../../../src/features/analytics/contracts.ts';
import { PeopleLens } from '../../../src/features/analytics/people-lens.tsx';
import { render, screen } from '../../../src/test/render.tsx';

const personId = '00000000-0000-7000-8000-000000000001';
const secondPersonId = '00000000-0000-7000-8000-000000000002';
const asOf = '2026-08-14T10:00:00.000Z';
const sprintId = '00000000-0000-7000-8000-000000000003';

function dayOffset(start: string, offset: number): string {
  const value = new Date(`${start}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function buildPersonBurn(options: {
  readonly start: string;
  readonly count: number;
  readonly observedCount: number;
  readonly scope: number;
}) {
  return Array.from({ length: options.count }, (_unused, index) => {
    const date = dayOffset(options.start, index);
    const observed = index < options.observedCount;
    const completed = observed ? index : 0;
    return {
      date,
      calendarDay: index + 1,
      workingDay: index + 1,
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

const fullSpanPersonBurn = buildPersonBurn({
  start: '2026-08-10',
  count: 10,
  observedCount: 6,
  scope: 8,
});
const cohort = (name: string, id = personId) => ({ cohort: `${name}:${id}` });
const person = (id: string, name: string, status: 'current' | 'former') => ({
  person: { id, name, image: null, currentMember: status === 'current', status },
  currentAssignments: 3,
  currentPoints: 8,
  completedIssues: 4,
  completedPoints: 11,
  activeWeeks: 2,
  averageThroughputIssues: 2,
  averageThroughputPoints: 5.5,
  cycleTime: { valid: 4, p50: 2, p85: 4 },
  leadTime: { valid: 4, p50: 5, p85: 8 },
  currentWip: 2,
  currentWipPoints: 5,
  wipAge: { valid: 2, p50: 3, p85: 6 },
  blocked: 1,
  overdue: 0,
  stale: 1,
  unestimated: 1,
  currentProjects: 1,
  currentMilestones: 1,
  currentSprints: 1,
  attribution: { captured: 2, reconstructed: 1, currentAssignee: 1, kind: 'mixed' as const },
  cohorts: {
    currentAssignments: cohort('person-current', id),
    completed: cohort('person-completed', id),
    wip: cohort('person-wip', id),
    blocked: cohort('person-blocked', id),
    overdue: cohort('person-overdue', id),
    stale: cohort('person-stale', id),
    unestimated: cohort('person-unestimated', id),
  },
});

const ada = person(personId, 'Ada Lovelace', 'former');
const data: AnalyticsPeopleResponse = {
  lens: 'people',
  asOf,
  people: [ada, person(secondPersonId, 'Grace Hopper', 'current')],
  totalPeople: 2,
  truncated: false,
  focused: {
    ...ada,
    projects: [
      { id: 'project', name: 'Platform', issues: 2, points: 5, cohort: cohort('person-project') },
    ],
    milestones: [],
    sprints: [],
    states: [
      { id: 'state', name: 'In progress', issues: 2, points: 5, cohort: cohort('person-state') },
    ],
    timeline: [
      {
        date: '2026-08-14',
        assignedIssues: 2,
        assignedPoints: 5,
        completedIssues: 1,
        completedPoints: 3,
        assignedCohort: cohort('person-assigned'),
        completedCohort: cohort('person-completed-bucket'),
      },
    ],
    sprintBurn: {
      selected: {
        id: sprintId,
        name: 'Sprint 4',
        number: 4,
        teamId: null,
        timezone: 'Asia/Kolkata',
        startsAt: '2026-08-10T03:30:00.000Z',
        endsAt: '2026-08-24T03:30:00.000Z',
        completedAt: null,
        archivedAt: null,
      },
      current: {
        personId,
        name: 'Ada Lovelace',
        burn: [
          {
            date: '2026-08-10',
            calendarDay: 1,
            workingDay: 1,
            scope: 8,
            started: 3,
            completed: 0,
            remaining: 8,
            added: 0,
            removed: 0,
            ideal: 8,
            available: true,
            coverage: 'captured',
            future: false,
          },
          {
            date: '2026-08-14',
            calendarDay: 5,
            workingDay: 5,
            scope: 8,
            started: 5,
            completed: 3,
            remaining: 5,
            added: 0,
            removed: 0,
            ideal: 5,
            available: true,
            coverage: 'live',
            future: false,
          },
        ],
        summary: {
          planned: 8,
          currentScope: 8,
          completed: 3,
          remaining: 5,
          added: 0,
          removed: 0,
          carryover: 0,
          unestimated: 0,
        },
        coverage: { kind: 'captured', from: '2026-08-10T03:30:00.000Z', asOf },
      },
      previous: null,
    },
  },
  coverage: { kind: 'reconstructed', from: '2026-08-01T00:00:00.000Z', asOf },
  formulas: {
    currentAssignments: 'Open work assigned now.',
    completed: 'Completed in the selected range, attributed at completion.',
    activeWeek: 'A week with an assignment episode or attributed completion.',
    cycleTime: 'Start to completion.',
    leadTime: 'Creation to completion.',
    wipAge: 'Time in the current working state.',
    attribution:
      'Captured close facts, then reconstructed assignment history, then current assignment.',
    points: 'Unestimated work contributes zero points.',
  },
};

describe('PeopleLens', () => {
  test('shows personal work and averages without ranking people', async () => {
    const onFocus = mock();
    const user = userEvent.setup();
    render(
      <PeopleLens
        data={data}
        onFocusPerson={onFocus}
        query={analyticsQuerySchema.parse({
          lens: 'people',
          measure: 'points',
          focus: { personId },
        })}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    expect(screen.getAllByText('Former member').length).toBeGreaterThan(0);
    expect(screen.getByText('Average throughput')).toBeVisible();
    expect(screen.getByText('Current assignments')).toBeVisible();
    expect(screen.getByText('Creation to completion.')).toBeVisible();
    expect(screen.getByText('Start to completion.')).toBeVisible();
    expect(screen.getByText(/some completion ownership was reconstructed/i)).toBeVisible();
    expect(screen.queryByText(/productivity score/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('application', { name: 'Ada Lovelace assignment and completion activity' }),
    ).toBeVisible();
    expect(
      screen.getByRole('application', { name: 'Ada Lovelace personal sprint burn' }),
    ).toBeVisible();
    expect(screen.getByText('Sprint 4')).toBeVisible();
    expect(screen.getByText('5 points remaining')).toBeVisible();
    expect(screen.getByText('1 unestimated issue counts as 1 point.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Grace Hopper/ }));
    expect(onFocus).toHaveBeenCalledWith(secondPersonId);
  });

  test('excludes an unavailable day from the personal burn instead of leaving a fabricated gap', async () => {
    const user = userEvent.setup();
    const focused = data.focused;
    if (focused === null) throw new Error('Missing focused person fixture.');
    const sprintBurn = focused.sprintBurn;
    const current = sprintBurn.current;
    if (current === null) throw new Error('Missing personal sprint burn fixture.');
    const firstBurnPoint = current.burn[0];
    if (firstBurnPoint === undefined) throw new Error('Missing burn fixture.');
    render(
      <PeopleLens
        data={{
          ...data,
          focused: {
            ...focused,
            sprintBurn: {
              ...sprintBurn,
              current: {
                ...current,
                burn: [
                  { ...firstBurnPoint, remaining: 0, scope: 0, ideal: 0, available: false },
                  ...current.burn.slice(1),
                ],
              },
            },
          },
        }}
        onFocusPerson={mock()}
        query={analyticsQuerySchema.parse({
          lens: 'people',
          measure: 'points',
          focus: { personId },
        })}
      />,
    );

    expect(screen.getByText(/capture began aug 14/i)).toBeVisible();
    expect(screen.queryByText(/dates unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('plot-line-current-person').getAttribute('d')).not.toContain('L');

    const dayHits = screen.getAllByTestId('plot-day-hit');
    expect(dayHits).toHaveLength(2);
    await user.hover(dayHits[0] as Element);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Ideal');
    expect(tooltip).not.toHaveTextContent('Current sprint');
  });

  test('frames the personal burn across the whole sprint with an ideal series', () => {
    const focused = data.focused;
    if (focused === null) throw new Error('Missing focused person fixture.');
    const current = focused.sprintBurn.current;
    if (current === null) throw new Error('Missing personal sprint burn fixture.');
    render(
      <PeopleLens
        data={{
          ...data,
          focused: {
            ...focused,
            sprintBurn: {
              ...focused.sprintBurn,
              current: { ...current, burn: fullSpanPersonBurn },
            },
          },
        }}
        onFocusPerson={mock()}
        query={analyticsQuerySchema.parse({
          lens: 'people',
          measure: 'points',
          focus: { personId },
        })}
      />,
    );

    expect(screen.getAllByTestId('plot-day-hit')).toHaveLength(fullSpanPersonBurn.length);
    expect(screen.getByTestId('plot-line-ideal-person')).toBeInTheDocument();
  });

  test('states the capture start once instead of a dates-unavailable fallback', () => {
    const focused = data.focused;
    if (focused === null) throw new Error('Missing focused person fixture.');
    const current = focused.sprintBurn.current;
    if (current === null) throw new Error('Missing personal sprint burn fixture.');
    const firstDay = fullSpanPersonBurn[0];
    if (firstDay === undefined) throw new Error('Missing burn fixture.');
    const retroBurn = [
      { ...firstDay, available: false, future: false, remaining: 0, scope: 0 },
      ...fullSpanPersonBurn.slice(1),
    ];
    render(
      <PeopleLens
        data={{
          ...data,
          focused: {
            ...focused,
            sprintBurn: { ...focused.sprintBurn, current: { ...current, burn: retroBurn } },
          },
        }}
        onFocusPerson={mock()}
        query={analyticsQuerySchema.parse({
          lens: 'people',
          measure: 'points',
          focus: { personId },
        })}
      />,
    );

    expect(screen.getByText(/capture began aug 11/i)).toBeVisible();
    expect(screen.queryByText(/dates unavailable/i)).not.toBeInTheDocument();
  });

  test('replaces the previous-sprint overlay with a caption since the frame cannot mix sprints', () => {
    const focused = data.focused;
    if (focused === null) throw new Error('Missing focused person fixture.');
    const sprintBurn = focused.sprintBurn;
    const current = sprintBurn.current;
    if (current === null) throw new Error('Missing personal sprint burn fixture.');
    render(
      <PeopleLens
        data={{
          ...data,
          focused: {
            ...focused,
            sprintBurn: {
              ...sprintBurn,
              previous: {
                personId,
                name: 'Ada Lovelace',
                burn: [],
                summary: {
                  planned: 6,
                  currentScope: 6,
                  completed: 4,
                  remaining: 2,
                  added: 0,
                  removed: 0,
                  carryover: 0,
                  unestimated: 0,
                },
                coverage: { kind: 'captured', from: '2026-07-27T00:00:00.000Z', asOf },
              },
            },
          },
        }}
        onFocusPerson={mock()}
        query={analyticsQuerySchema.parse({
          lens: 'people',
          measure: 'points',
          focus: { personId },
        })}
      />,
    );

    expect(screen.getByText(/previous sprint ended with 2 points remaining/i)).toBeVisible();
    expect(screen.queryByTestId('plot-line-previous-person')).not.toBeInTheDocument();
  });
});
