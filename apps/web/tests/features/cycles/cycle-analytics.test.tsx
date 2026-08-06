import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';
import { CycleAnalytics } from '../../../src/features/cycles/cycle-board.tsx';
import type { CycleView } from '../../../src/features/cycles/data.ts';

interface ProgressOverrides {
  readonly scope?: number;
  readonly canceled?: number;
  readonly estimated?: number;
  readonly points?: { scope: number; started: number; completed: number };
  readonly changes?: { added: number; addedPoints: number; removed: number; removedPoints: number };
}

function cycleWith(overrides: ProgressOverrides): CycleView {
  return {
    id: 'cycle_1',
    name: 'Sprint 4',
    number: 4,
    teamId: 'team_1',
    teamKey: 'ENG',
    teamName: 'Engineering',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-15T00:00:00.000Z',
    groups: [],
    assignees: [{ id: 'member_1', name: 'Ada Lovelace', image: null, scope: 3, completed: 2 }],
    progress: {
      cycleId: 'cycle_1',
      scope: overrides.scope ?? 4,
      started: 1,
      completed: 2,
      canceled: overrides.canceled ?? 0,
      estimated: overrides.estimated ?? 0,
      points: overrides.points ?? { scope: 0, started: 0, completed: 0 },
      changes: overrides.changes ?? { added: 0, addedPoints: 0, removed: 0, removedPoints: 0 },
      burnUp: [
        { date: '2026-01-01', scope: 3, scopePoints: 8, completed: 0, completedPoints: 0 },
        { date: '2026-01-02', scope: 4, scopePoints: 13, completed: 1, completedPoints: 5 },
        { date: '2026-01-03', scope: 4, scopePoints: 13, completed: 2, completedPoints: 8 },
      ],
    },
  };
}

afterEach(cleanup);

describe('CycleAnalytics', () => {
  it('draws the scope the sprint carried alongside the completed line', () => {
    render(<CycleAnalytics cycle={cycleWith({})} />);

    const scope = screen.getByTestId('chart-series-scope');
    expect(scope.textContent).toContain('Scope');
    expect(screen.getByTestId('chart-series-completed')).toBeDefined();
    expect(screen.getByTestId('chart-series-ideal')).toBeDefined();
  });

  it('counts issues while nothing in the sprint is estimated', () => {
    render(<CycleAnalytics cycle={cycleWith({})} />);

    expect(screen.queryByTestId('sprint-points')).toBeNull();
  });

  it('shows the points total once an issue carries an estimate', () => {
    render(
      <CycleAnalytics
        cycle={cycleWith({ estimated: 3, points: { scope: 13, started: 3, completed: 8 } })}
      />,
    );

    const points = screen.getByTestId('sprint-points');
    expect(points.textContent).toContain('13');
    expect(points.textContent).toContain('8');
  });

  it('says what came in and what went out during the sprint', () => {
    render(
      <CycleAnalytics
        cycle={cycleWith({
          canceled: 2,
          changes: { added: 3, addedPoints: 8, removed: 1, removedPoints: 2 },
        })}
      />,
    );

    const changes = screen.getByTestId('sprint-scope-changes');
    expect(changes.textContent).toContain('3 added');
    expect(changes.textContent).toContain('1 removed');
    expect(changes.textContent).toContain('2 cancelled');
  });

  it('leaves the scope change line out of a sprint that never moved', () => {
    render(<CycleAnalytics cycle={cycleWith({})} />);

    expect(screen.queryByTestId('sprint-scope-changes')).toBeNull();
  });

  it('keeps the per assignee breakdown', () => {
    render(<CycleAnalytics cycle={cycleWith({})} />);

    expect(screen.getByText('Ada Lovelace')).toBeDefined();
    expect(screen.getByText('2/3')).toBeDefined();
  });
});
