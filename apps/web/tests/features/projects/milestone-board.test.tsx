import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { createQueryClient } from '@/lib/query/provider.tsx';
import type { Milestone } from '@/lib/query/schemas.ts';
import { MilestoneBoard } from '../../../src/features/projects/milestone-board.tsx';

const PROJECT_ID = 'project_launch';

function milestone(id: string, name: string, sortOrder: number): Milestone {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    description: '',
    targetDate: null,
    sortOrder,
    scope: 0,
    completed: 0,
  };
}

let served: Milestone[] = [];

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

const calls: Call[] = [];
const originalFetch = globalThis.fetch;

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (method === 'GET') return Promise.resolve(Response.json({ milestones: served }));
    if (url.endsWith('/reorder')) {
      const ids = (body as { milestoneIds: string[] }).milestoneIds;
      served = ids.flatMap((id) => served.filter((entry) => entry.id === id));
      return Promise.resolve(Response.json({ milestones: served }));
    }
    if (method === 'DELETE') {
      served = served.filter((entry) => !url.endsWith(entry.id));
      return Promise.resolve(Response.json({ deleted: true }));
    }
    if (method === 'PATCH') {
      const patch = body as { name: string };
      served = served.map((entry) =>
        url.endsWith(entry.id) ? { ...entry, name: patch.name } : entry,
      );
      return Promise.resolve(Response.json({ milestone: served[0] }));
    }
    const draft = body as { name: string };
    const created = milestone(`milestone_${served.length + 1}`, draft.name, served.length + 1);
    served = [...served, created];
    return Promise.resolve(Response.json({ milestone: created }));
  }) as unknown as typeof fetch;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function mountBoard(canManage = true) {
  render(
    <Providers>
      <MilestoneBoard projectId={PROJECT_ID} milestones={served} canManage={canManage} />
    </Providers>,
  );
}

function names(): string[] {
  return screen
    .getAllByTestId(/^milestone-milestone_/)
    .map((row) => row.querySelector('span')?.textContent ?? '');
}

function writes(): Call[] {
  return calls.filter((call) => call.method !== 'GET');
}

function firstWrite(): Call {
  const [call] = writes();
  if (call === undefined) throw new Error('the board sent no write');
  return call;
}

function writtenName(): string {
  return (firstWrite().body as { name: string }).name;
}

beforeEach(() => {
  calls.length = 0;
  served = [
    milestone('milestone_1', 'One', 1),
    milestone('milestone_2', 'Two', 2),
    milestone('milestone_3', 'Three', 3),
  ];
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('MilestoneBoard', () => {
  it('adds a milestone against the project it was mounted on', async () => {
    mountBoard();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('milestone-add'));
    await user.type(screen.getByTestId('milestone-new-name'), 'Cut over');
    await user.click(screen.getByTestId('milestone-new-submit'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/milestones`,
    });
    expect(writtenName()).toBe('Cut over');
  });

  it('renames a milestone through the milestone route', async () => {
    mountBoard();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('milestone-edit-milestone_2'));
    const field = screen.getByTestId('milestone-edit-name');
    await user.clear(field);
    await user.type(field, 'Second pass');
    await user.click(screen.getByTestId('milestone-edit-submit'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({
      method: 'PATCH',
      url: '/api/milestones/milestone_2',
    });
    expect(writtenName()).toBe('Second pass');
  });

  it('deletes a milestone and drops it from the list', async () => {
    mountBoard();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('milestone-delete-milestone_1'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({
      method: 'DELETE',
      url: '/api/milestones/milestone_1',
    });
    await waitFor(() => expect(names()).toEqual(['Two', 'Three']));
  });

  it('sends the whole order when a milestone moves down, not just the pair', async () => {
    mountBoard();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('milestone-down-milestone_1'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/milestones/reorder`,
      body: { milestoneIds: ['milestone_2', 'milestone_1', 'milestone_3'] },
    });
    await waitFor(() => expect(names()).toEqual(['Two', 'One', 'Three']));
  });

  it('sends the whole order when a milestone moves up', async () => {
    mountBoard();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('milestone-up-milestone_3'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({
      body: { milestoneIds: ['milestone_1', 'milestone_3', 'milestone_2'] },
    });
  });

  it('shows the counts the server sent rather than any it worked out itself', async () => {
    served = [{ ...milestone('milestone_1', 'One', 1), scope: 7, completed: 3 }];
    mountBoard();

    const row = await screen.findByTestId('milestone-milestone_1');
    await waitFor(() => expect(row).toHaveTextContent('3/7'));
    expect(screen.getByLabelText('One completion')).toHaveAttribute('aria-valuenow', '43');
  });

  it('cannot move the first one up or the last one down', () => {
    mountBoard();

    expect(screen.getByTestId('milestone-up-milestone_1')).toBeDisabled();
    expect(screen.getByTestId('milestone-down-milestone_3')).toBeDisabled();
    expect(screen.getByTestId('milestone-down-milestone_1')).not.toBeDisabled();
  });

  it('offers no controls at all to somebody who cannot manage milestones', async () => {
    mountBoard(false);
    await waitFor(() => expect(names()).toEqual(['One', 'Two', 'Three']));

    expect(screen.queryByTestId('milestone-add')).toBeNull();
    expect(screen.queryByTestId('milestone-delete-milestone_1')).toBeNull();
    expect(screen.queryByTestId('milestone-up-milestone_2')).toBeNull();
    expect(screen.queryByTestId('milestone-edit-milestone_2')).toBeNull();
    expect(writes()).toEqual([]);
  });
});
