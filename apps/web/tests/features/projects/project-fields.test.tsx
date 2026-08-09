import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { ProjectFields } from '@/features/projects/project-fields.tsx';
import { queryKeys } from '@/lib/query/keys.ts';

const requests: { url: string; body: unknown }[] = [];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  requests.push({ url: String(input), body });
  return Promise.resolve(
    new Response(JSON.stringify({ project: { id: 'project_1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as typeof fetch;

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const members = [
  { id: 'user_1', name: 'Ada Admin', image: null },
  { id: 'user_2', name: 'Mo Member', image: null },
];
const teams = [
  { id: 'team_1', key: 'ENG', name: 'Engineering' },
  { id: 'team_2', key: 'DES', name: 'Design' },
];

function fields(overrides: Record<string, unknown> = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <ProjectFields
            projectId="project_1"
            lead={null}
            startDate={null}
            targetDate="2026-10-10"
            status="planned"
            teamIds={['team_1']}
            members={members}
            teams={teams}
            canManage
            progress={<span>progress</span>}
            {...overrides}
          />
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  requests.length = 0;
  queryClient.clear();
  queryClient.setQueryData(queryKeys.bootstrap(null), { projects: [] });
});

afterEach(cleanup);

describe('the fields across the top of a project', () => {
  it('sets the lead from the header', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(fields());

    await user.click(screen.getByTestId('project-lead'));
    await user.click(await screen.findByTestId('project-lead-user_2'));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.url).toBe('/api/projects/project_1');
    expect(requests[0]?.body).toEqual({ leadId: 'user_2' });
  });

  it('clears the lead again', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(fields({ lead: members[1] }));

    await user.click(screen.getByTestId('project-lead'));
    await user.click(await screen.findByTestId('project-lead-none'));

    await waitFor(() => expect(requests[0]?.body).toEqual({ leadId: null }));
  });

  it('sets a start date from the header', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(fields());

    await user.click(screen.getByTestId('project-start-date'));
    const input = await screen.findByTestId('project-start-date-input');
    await user.type(input, '2026-09-01');

    await waitFor(() => expect(requests.at(-1)?.body).toEqual({ startDate: '2026-09-01' }));
  });

  it('changes the status from the header', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(fields());

    await user.click(screen.getByTestId('project-status-field'));
    await user.click(await screen.findByTestId('project-status-in_progress'));

    await waitFor(() => expect(requests[0]?.body).toEqual({ status: 'in_progress' }));
  });

  it('adds a team without dropping the one already there', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(fields());

    await user.click(screen.getByTestId('project-teams'));
    await user.click(await screen.findByTestId('project-team-team_2'));

    await waitFor(() => expect(requests[0]?.body).toEqual({ teamIds: ['team_1', 'team_2'] }));
  });

  it('takes a team off the project', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(fields());

    await user.click(screen.getByTestId('project-teams'));
    await user.click(await screen.findByTestId('project-team-team_1'));

    await waitFor(() => expect(requests[0]?.body).toEqual({ teamIds: [] }));
    expect(queryClient.getQueryState(queryKeys.bootstrap(null))?.isInvalidated).toBe(true);
  });

  it('shows plain text, and no controls, to somebody who may not manage the project', () => {
    render(fields({ canManage: false, lead: members[0] }));

    expect(screen.queryByTestId('project-lead')).toBeNull();
    expect(screen.queryByTestId('project-status-field')).toBeNull();
    expect(screen.queryByTestId('project-start-date')).toBeNull();
    expect(screen.getByTestId('project-fields').textContent).toContain('Ada Admin');
  });
});
