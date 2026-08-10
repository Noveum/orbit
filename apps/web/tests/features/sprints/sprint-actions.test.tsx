import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { CycleView, UpcomingCycleView } from '@/features/sprints/data.ts';

const calls: { url: string; method: string; body: string | undefined }[] = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({
    url: String(input),
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  return Promise.resolve(
    new Response(
      JSON.stringify({
        cycle: {
          id: 'cycle_next',
          teamId: 'team_eng',
          number: 5,
          name: 'Sprint 5',
          startsAt: '2026-02-01T00:00:00.000Z',
          endsAt: '2026-02-15T00:00:00.000Z',
          completedAt: null,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}) as typeof fetch;

const refreshes: number[] = [];

mock.module('next/navigation', () => ({
  useRouter: () => ({
    refresh: () => {
      refreshes.push(Date.now());
    },
    push: () => undefined,
  }),
}));

const { SprintHeader } = await import('@/features/sprints/sprint-header.tsx');
const { SprintSchedule } = await import('@/features/sprints/sprint-schedule.tsx');

const RUNNING: CycleView = {
  id: 'cycle_running',
  name: 'Sprint 4',
  number: 4,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2026-01-15T00:00:00.000Z',
  completedAt: null,
  groups: [],
  assignees: [],
  progress: {
    cycleId: 'cycle_running',
    scope: 0,
    started: 0,
    completed: 0,
    canceled: 0,
    uncommitted: { issues: 0, points: 0 },
    estimated: 0,
    points: { scope: 0, started: 0, completed: 0 },
    changes: { added: 0, addedPoints: 0, removed: 0, removedPoints: 0 },
    burnUp: [],
  },
};

const CLOSED: CycleView = { ...RUNNING, completedAt: '2026-01-15T09:00:00.000Z' };

const UPCOMING: UpcomingCycleView[] = [
  {
    id: 'cycle_next',
    name: 'Sprint 5',
    startsAt: '2026-02-01T00:00:00.000Z',
    endsAt: '2026-02-15T00:00:00.000Z',
  },
];

function renderPanel(options: {
  cycle: CycleView | null;
  canManage: boolean;
  upcoming?: UpcomingCycleView[];
  runningSprintId?: string | null;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  render(
    <Wrapper>
      {options.cycle === null ? null : (
        <SprintHeader sprint={options.cycle} canManage={options.canManage} />
      )}
      <SprintSchedule
        upcoming={options.upcoming ?? UPCOMING}
        canManage={options.canManage}
        running={(options.runningSprintId ?? null) !== null}
      />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  calls.length = 0;
  refreshes.length = 0;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('sprint controls on the sprint panel', () => {
  it('hides every control from somebody whose role cannot manage sprints', () => {
    renderPanel({ cycle: RUNNING, canManage: false, runningSprintId: RUNNING.id });

    expect(screen.queryByTestId('sprint-new')).toBeNull();
    expect(screen.queryByTestId('sprint-complete-cycle_running')).toBeNull();
    expect(screen.queryByTestId('sprint-edit-cycle_running')).toBeNull();
    expect(screen.queryByTestId('sprint-start-cycle_next')).toBeNull();
    expect(screen.queryByTestId('sprint-delete-cycle_next')).toBeNull();
  });

  it('offers create, edit and complete while a sprint is running', () => {
    renderPanel({ cycle: RUNNING, canManage: true, runningSprintId: RUNNING.id });

    expect(screen.getByTestId('sprint-new')).toBeVisible();
    expect(screen.getByTestId('sprint-edit-cycle_running')).toBeVisible();
    expect(screen.getByTestId('sprint-complete-cycle_running')).toBeVisible();
    expect(screen.queryByTestId('sprint-start-cycle_next')).toBeNull();
  });

  it('offers start on a planned sprint once nothing is running', () => {
    renderPanel({ cycle: null, canManage: true });

    expect(screen.getByTestId('sprint-start-cycle_next')).toBeVisible();
    expect(screen.getByTestId('sprint-new')).toBeVisible();
  });

  it('leaves a closed sprint alone rather than offering to complete it again', () => {
    renderPanel({ cycle: CLOSED, canManage: true, runningSprintId: 'cycle_elsewhere' });

    expect(screen.queryByTestId('sprint-complete-cycle_running')).toBeNull();
    expect(screen.queryByTestId('sprint-edit-cycle_running')).toBeNull();
    expect(screen.queryByTestId('sprint-start-cycle_next')).toBeNull();
  });

  it('asks the server to start a sprint without sending a date of its own', async () => {
    renderPanel({ cycle: null, canManage: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sprint-start-cycle_next'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe('/api/cycles/cycle_next/start');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBeUndefined();
    await waitFor(() => expect(refreshes).toHaveLength(1));
  });

  it('creates a sprint with an empty body when the dates are left empty', async () => {
    renderPanel({ cycle: RUNNING, canManage: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sprint-new'));
    await user.click(await screen.findByTestId('sprint-create-dialog-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe('/api/cycles');
    expect(calls[0]?.body).toBe(JSON.stringify({}));
  });

  it('sends only the name when a sprint is renamed and its dates are left alone', async () => {
    renderPanel({ cycle: RUNNING, canManage: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sprint-edit-cycle_running'));
    const name = await screen.findByTestId('sprint-edit-dialog-name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByTestId('sprint-edit-dialog-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe('/api/cycles/cycle_running');
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toBe(JSON.stringify({ name: 'Renamed' }));
  });

  it('never sends back a day that would drag a started sprint to midnight', async () => {
    const started: CycleView = { ...RUNNING, startsAt: '2026-01-01T14:32:07.000Z' };
    renderPanel({ cycle: started, canManage: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sprint-edit-cycle_running'));
    const name = await screen.findByTestId('sprint-edit-dialog-name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByTestId('sprint-edit-dialog-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0]?.body ?? '{}')).not.toHaveProperty('startsAt');
  });

  it('sends the day the user actually moved and nothing they left alone', async () => {
    renderPanel({ cycle: RUNNING, canManage: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sprint-edit-cycle_running'));
    const endsAt = await screen.findByTestId('sprint-edit-dialog-ends');
    await user.clear(endsAt);
    await user.type(endsAt, '2026-01-22');
    await user.click(screen.getByTestId('sprint-edit-dialog-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toBe(JSON.stringify({ endsAt: '2026-01-22' }));
  });

  it('deletes a planned sprint only after the confirmation is taken', async () => {
    renderPanel({ cycle: RUNNING, canManage: true });
    const user = userEvent.setup();

    await user.click(screen.getByTestId('sprint-delete-cycle_next'));
    expect(calls).toHaveLength(0);

    await user.click(await screen.findByTestId('sprint-delete-dialog-confirm'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toBe('/api/cycles/cycle_next');
    expect(calls[0]?.method).toBe('DELETE');
  });
});
