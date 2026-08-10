import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { atRisk, SprintRollUp, sprintDay } = await import('@/features/sprints/sprint-roll-up.tsx');

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>
  );
}

afterEach(cleanup);

const NOW = new Date('2026-08-10T00:00:00.000Z');

function entry(overrides: Partial<{ committedPoints: number; completedPoints: number }> = {}) {
  return {
    team: { id: 'team_nov', key: 'NOV', name: 'Noveum' },
    sprint: {
      teamId: 'team_nov',
      cycleId: 'cycle_1',
      number: 1,
      name: '',
      startsAt: new Date('2026-08-09T00:00:00.000Z'),
      endsAt: new Date('2026-08-24T00:00:00.000Z'),
      committedIssues: 31,
      completedIssues: 4,
      committedPoints: 94,
      completedPoints: 12,
      ...overrides,
    },
  };
}

describe('sprintDay', () => {
  it('counts the first day as day one', () => {
    expect(
      sprintDay(new Date('2026-08-09'), new Date('2026-08-23'), new Date('2026-08-09')),
    ).toEqual({ day: 1, total: 14 });
  });

  it('clamps a sprint read after it ended', () => {
    expect(
      sprintDay(new Date('2026-08-09'), new Date('2026-08-23'), new Date('2026-09-01')),
    ).toEqual({ day: 14, total: 14 });
  });

  it('clamps a sprint read before it began', () => {
    expect(
      sprintDay(new Date('2026-08-09'), new Date('2026-08-23'), new Date('2026-08-01')),
    ).toEqual({ day: 1, total: 14 });
  });
});

describe('atRisk', () => {
  it('flags a sprint past halfway with little completed', () => {
    expect(atRisk(entry(), new Date('2026-08-20'))).toBe(true);
  });

  it('does not flag a sprint that has barely started', () => {
    expect(atRisk(entry(), NOW)).toBe(false);
  });

  it('does not flag a sprint with nothing committed', () => {
    expect(atRisk(entry({ committedPoints: 0, completedPoints: 0 }), new Date('2026-08-20'))).toBe(
      false,
    );
  });

  it('does not flag a sprint that is keeping pace', () => {
    expect(atRisk(entry({ completedPoints: 60 }), new Date('2026-08-20'))).toBe(false);
  });

  it('does not flag a team with no sprint', () => {
    const none = { team: { id: 'team_ui', key: 'UI', name: 'UI Team' }, sprint: null };
    expect(atRisk(none, NOW)).toBe(false);
  });
});

describe('SprintRollUp', () => {
  it('renders one row per team and falls back to the sprint number', () => {
    render(wrap(<SprintRollUp entries={[entry()]} canManage={true} now={NOW} />));

    expect(screen.getByText('NOV')).toBeDefined();
    expect(screen.getByText('Sprint 1')).toBeDefined();
    expect(screen.getByTestId('roll-up-points-team_nov').textContent).toContain('12 / 94');
  });

  it('prefers a sprint name over the number when one is set', () => {
    const named = { ...entry(), sprint: { ...entry().sprint, name: 'Hardening' } };
    render(wrap(<SprintRollUp entries={[named]} canManage={true} now={NOW} />));

    expect(screen.getByText('Hardening')).toBeDefined();
  });

  it('links a row at the team and sprint number', () => {
    render(wrap(<SprintRollUp entries={[entry()]} canManage={true} now={NOW} />));

    expect(screen.getByTestId('roll-up-row-team_nov').getAttribute('href')).toBe(
      '/team/nov/sprint/1',
    );
  });

  it('offers to start a sprint for a team without one', () => {
    render(
      wrap(
        <SprintRollUp
          entries={[{ team: { id: 'team_ui', key: 'UI', name: 'UI Team' }, sprint: null }]}
          canManage={true}
          now={NOW}
        />,
      ),
    );

    expect(screen.getByTestId('roll-up-empty-team_ui')).toBeDefined();
  });

  it('hides the create affordance without permission', () => {
    render(
      wrap(
        <SprintRollUp
          entries={[{ team: { id: 'team_ui', key: 'UI', name: 'UI Team' }, sprint: null }]}
          canManage={false}
          now={NOW}
        />,
      ),
    );

    expect(screen.queryByTestId('sprint-new-team_ui')).toBeNull();
  });

  it('puts an at risk sprint above one that is on pace', () => {
    const risky = entry();
    const healthy = {
      team: { id: 'team_am', key: 'AM', name: 'API market' },
      sprint: { ...entry().sprint, teamId: 'team_am', cycleId: 'cycle_2', completedPoints: 90 },
    };
    render(
      wrap(
        <SprintRollUp entries={[healthy, risky]} canManage={false} now={new Date('2026-08-20')} />,
      ),
    );

    const rows = screen.getAllByTestId(/roll-up-row-/);
    expect(rows[0]?.getAttribute('data-testid')).toBe('roll-up-row-team_nov');
  });

  it('says so when there are no teams at all', () => {
    render(wrap(<SprintRollUp entries={[]} canManage={true} now={NOW} />));

    expect(screen.getByText('No teams yet')).toBeDefined();
  });
});
