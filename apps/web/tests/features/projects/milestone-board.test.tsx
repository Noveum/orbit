import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
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
      const patch = body as { name: string; description: string; targetDate: string | null };
      served = served.map((entry) => (url.endsWith(entry.id) ? { ...entry, ...patch } : entry));
      return Promise.resolve(Response.json({ milestone: served[0] }));
    }
    const draft = body as { name: string; description: string; targetDate: string | null };
    const created = {
      ...milestone(`milestone_${served.length + 1}`, draft.name, served.length + 1),
      ...draft,
    };
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
  it('renders headings, lists, emphasis and links in milestone descriptions', () => {
    served = [
      {
        ...milestone('milestone_1', 'Release', 1),
        description:
          '## Release notes\n\n- Ship **search**\n- Review [changes](https://example.com/changes)\n\nRun `smoke` before release.',
      },
    ];
    mountBoard(false);

    const row = screen.getByTestId('milestone-milestone_1');
    expect(within(row).getByRole('heading', { level: 2, name: 'Release notes' })).toBeVisible();
    expect(within(row).getAllByRole('listitem')).toHaveLength(2);
    expect(row.querySelector('strong')).toHaveTextContent('search');
    expect(row.querySelector('code')).toHaveTextContent('smoke');
    const link = within(row).getByRole('link', { name: 'changes' });
    expect(link).toHaveAttribute('href', 'https://example.com/changes');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(writes()).toEqual([]);
  });

  it('keeps plain text and paragraph breaks readable', () => {
    served = [
      { ...milestone('milestone_1', 'Release', 1), description: 'First paragraph.\n\n验收通过。' },
    ];
    mountBoard();

    const row = screen.getByTestId('milestone-milestone_1');
    expect(row.querySelectorAll('p')).toHaveLength(2);
    expect(within(row).getByText('First paragraph.')).toBeVisible();
    expect(within(row).getByText('验收通过。')).toBeVisible();
  });

  it('uses the shared overflow containers for tables and fenced code', () => {
    served = [
      {
        ...milestone('milestone_1', 'Release', 1),
        description: '| Check | Result |\n| --- | --- |\n| Search | Passed |\n\n```sh\nsmoke\n```',
      },
    ];
    mountBoard();

    const body = screen.getByTestId('doc-body');
    expect(body).toHaveClass('[overflow-wrap:anywhere]', 'min-w-0');
    expect(screen.getByTestId('milestone-milestone_1')).toHaveClass('min-w-0');
    expect(within(body).getByRole('table').parentElement).toHaveAttribute('data-table-scroll');
    expect(body.querySelector('pre code')).toHaveTextContent('smoke');
    expect(within(body).getByRole('button', { name: 'Copy the code' })).toBeVisible();
  });

  it('sanitizes milestone markdown before inserting it into the page', () => {
    served = [
      {
        ...milestone('milestone_1', 'Release', 1),
        description:
          '## Safe heading\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n<img src="https://example.com/image.png" onerror="alert(1)">',
      },
    ];
    mountBoard();

    const row = screen.getByTestId('milestone-milestone_1');
    expect(within(row).getByRole('heading', { name: 'Safe heading' })).toBeVisible();
    expect(row.querySelector('script')).toBeNull();
    expect(row.querySelector('[onerror]')).toBeNull();
    expect(row.querySelector('[href^="javascript:"]')).toBeNull();
    expect(row).not.toHaveTextContent('alert(1)');
  });

  it('does not render a description body for an empty description', () => {
    mountBoard();

    expect(screen.queryByTestId('doc-body')).toBeNull();
  });

  it('preserves markdown source when editing and renders the saved description', async () => {
    const source = '## Release notes\n\n- Ship **search**\n- Review [changes](https://example.com)';
    served = [{ ...milestone('milestone_1', 'Release', 1), description: source }];
    mountBoard();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('milestone-edit-milestone_1'));
    expect(screen.getByTestId('milestone-edit-description')).toHaveValue(source);
    await user.click(screen.getByTestId('milestone-edit-submit'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({
      method: 'PATCH',
      url: '/api/milestones/milestone_1',
      body: { description: source },
    });
    expect(await screen.findByRole('heading', { name: 'Release notes' })).toBeVisible();
  });

  it('renders markdown after creating a milestone without sending rendered HTML', async () => {
    mountBoard();
    const user = userEvent.setup();
    const source = '## Acceptance\n\n- Ship **search**';

    await user.click(screen.getByTestId('milestone-add'));
    await user.type(screen.getByTestId('milestone-new-name'), 'Release');
    await user.type(screen.getByTestId('milestone-new-description'), source);
    await user.click(screen.getByTestId('milestone-new-submit'));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(firstWrite()).toMatchObject({ method: 'POST', body: { description: source } });
    expect(await screen.findByRole('heading', { name: 'Acceptance' })).toBeVisible();
  });

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
