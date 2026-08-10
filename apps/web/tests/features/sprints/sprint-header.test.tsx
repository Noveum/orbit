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
          name: 'Hardening',
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

const { SprintHeader } = await import('@/features/sprints/sprint-header.tsx');

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
  number: 1,
  startsAt: '2026-08-09T00:00:00.000Z',
  endsAt: '2026-08-23T00:00:00.000Z',
  completedAt: null,
};

beforeEach(() => {
  bodies.length = 0;
});

afterEach(cleanup);

describe('SprintHeader', () => {
  it('shows the numbered fallback when the sprint has no name', () => {
    render(wrap(<SprintHeader sprint={SPRINT} canManage={true} />));

    expect(screen.getByTestId('sprint-name').textContent).toBe('Sprint 1');
  });

  it('makes the sprint name the page heading', () => {
    render(wrap(<SprintHeader sprint={SPRINT} canManage={true} />));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sprint 1');
  });

  it('shows a chosen name in place of the number', () => {
    render(wrap(<SprintHeader sprint={{ ...SPRINT, name: 'Hardening' }} canManage />));

    expect(screen.getByTestId('sprint-name').textContent).toBe('Hardening');
  });

  it('saves a new name on blur', async () => {
    render(wrap(<SprintHeader sprint={SPRINT} canManage={true} />));

    await userEvent.click(screen.getByTestId('sprint-name'));
    await userEvent.type(screen.getByTestId('sprint-name-input'), 'Hardening');
    await userEvent.tab();

    await waitFor(() => {
      expect(bodies.some((body) => body.includes('Hardening'))).toBe(true);
    });
  });

  it('does not save when the name comes back unchanged', async () => {
    render(wrap(<SprintHeader sprint={{ ...SPRINT, name: 'Hardening' }} canManage />));

    await userEvent.click(screen.getByTestId('sprint-name'));
    await userEvent.tab();

    expect(bodies).toHaveLength(0);
  });

  it('abandons the edit on escape', async () => {
    render(wrap(<SprintHeader sprint={SPRINT} canManage={true} />));

    await userEvent.click(screen.getByTestId('sprint-name'));
    await userEvent.type(screen.getByTestId('sprint-name-input'), 'Throwaway{Escape}');

    expect(bodies).toHaveLength(0);
    expect(screen.getByTestId('sprint-name').textContent).toBe('Sprint 1');
  });

  it('does not offer renaming without permission', async () => {
    render(wrap(<SprintHeader sprint={SPRINT} canManage={false} />));

    await userEvent.click(screen.getByTestId('sprint-name'));

    expect(screen.queryByTestId('sprint-name-input')).toBeNull();
  });

  it('counts the day of a running sprint', () => {
    render(wrap(<SprintHeader sprint={SPRINT} canManage={false} />));

    expect(screen.getByTestId('sprint-day').textContent).toContain('of 14');
  });

  it('drops the day counter and the actions once the sprint is closed', () => {
    render(
      wrap(
        <SprintHeader
          sprint={{ ...SPRINT, completedAt: '2026-08-23T00:00:00.000Z' }}
          canManage={true}
        />,
      ),
    );

    expect(screen.queryByTestId('sprint-day')).toBeNull();
    expect(screen.queryByTestId('sprint-complete-cycle_1')).toBeNull();
  });
});
