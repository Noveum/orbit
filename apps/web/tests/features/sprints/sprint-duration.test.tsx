import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';

const bodies: string[] = [];

globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof init?.body === 'string') bodies.push(init.body);
  return Promise.resolve(
    new Response(
      JSON.stringify({
        cycle: {
          id: 'cycle_1',
          teamId: 'team_nov',
          number: 1,
          name: '',
          startsAt: '2026-08-09T00:00:00.000Z',
          endsAt: '2026-08-23T00:00:00.000Z',
          completedAt: null,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}) as typeof fetch;

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { EditSprintButton, endAfterWeeks, weeksBetween } = await import(
  '@/features/sprints/sprint-actions.tsx'
);

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>
  );
}

const SPRINT = {
  id: 'cycle_1',
  name: '',
  startsAt: '2026-08-09T00:00:00.000Z',
  endsAt: '2026-08-23T00:00:00.000Z',
};

beforeEach(() => {
  bodies.length = 0;
});

afterEach(cleanup);

describe('endAfterWeeks', () => {
  it('adds whole weeks to a start day', () => {
    expect(endAfterWeeks('2026-08-09', 2)).toBe('2026-08-23');
    expect(endAfterWeeks('2026-08-09', 1)).toBe('2026-08-16');
  });

  it('gives nothing back when the start is not a date', () => {
    expect(endAfterWeeks('', 2)).toBe('');
  });
});

describe('weeksBetween', () => {
  it('reads a whole number of weeks', () => {
    expect(weeksBetween('2026-08-09', '2026-08-23')).toBe(2);
  });

  it('refuses a span that is not a whole number of weeks', () => {
    expect(weeksBetween('2026-08-09', '2026-08-20')).toBeNull();
  });

  it('refuses a span that ends before it starts', () => {
    expect(weeksBetween('2026-08-23', '2026-08-09')).toBeNull();
  });
});

describe('the sprint edit dialog', () => {
  it('sets the end date from a duration preset', async () => {
    render(wrap(<EditSprintButton sprint={SPRINT} />));
    await userEvent.click(screen.getByTestId('sprint-edit-cycle_1'));

    await userEvent.click(screen.getByTestId('sprint-edit-dialog-weeks-3'));

    expect(screen.getByTestId('sprint-edit-dialog-ends').getAttribute('value')).toBe('2026-08-30');
  });

  it('sends the shift flag when the box is ticked and the end moved', async () => {
    render(wrap(<EditSprintButton sprint={SPRINT} />));
    await userEvent.click(screen.getByTestId('sprint-edit-cycle_1'));

    await userEvent.click(screen.getByTestId('sprint-edit-dialog-weeks-3'));
    await userEvent.click(screen.getByTestId('sprint-edit-dialog-shift'));
    await userEvent.click(screen.getByTestId('sprint-edit-dialog-submit'));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    const sent = JSON.parse(bodies[0] ?? '{}');
    expect(sent.endsAt).toBe('2026-08-30');
    expect(sent.shiftFollowing).toBe(true);
  });

  it('leaves the shift flag off when the dates did not move', async () => {
    render(wrap(<EditSprintButton sprint={SPRINT} />));
    await userEvent.click(screen.getByTestId('sprint-edit-cycle_1'));

    await userEvent.click(screen.getByTestId('sprint-edit-dialog-shift'));
    await userEvent.click(screen.getByTestId('sprint-edit-dialog-submit'));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(JSON.parse(bodies[0] ?? '{}').shiftFollowing).toBeUndefined();
  });

  it('clears a custom name back to the numbered default', async () => {
    render(wrap(<EditSprintButton sprint={{ ...SPRINT, name: 'Hardening' }} />));
    await userEvent.click(screen.getByTestId('sprint-edit-cycle_1'));

    await userEvent.clear(screen.getByTestId('sprint-edit-dialog-name'));
    await userEvent.click(screen.getByTestId('sprint-edit-dialog-submit'));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(JSON.parse(bodies[0] ?? '{}').name).toBe('');
  });
});
