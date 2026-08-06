import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { createQueryClient } from '@/lib/query/provider.tsx';
import type { Issue, Member, WorkflowState } from '@/lib/query/schemas.ts';

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => undefined,
    back: () => undefined,
  }),
  usePathname: () => '/standup',
  useSearchParams: () => new URLSearchParams(),
}));

const { IssuePeek: realIssuePeek } = await import('@/features/issues/issue-peek.tsx');

mock.module('@/features/issues/issue-peek.tsx', () => ({
  IssuePeek: ({ issue }: { issue: Issue | undefined }) =>
    issue === undefined ? null : <div data-testid="issue-peek">{issue.identifier}</div>,
}));

function state(id: string, category: string): WorkflowState {
  return { id, teamId: 'team_eng', name: id, category, color: '#666666', position: 0 };
}

const states: readonly WorkflowState[] = [
  state('state_todo', 'unstarted'),
  state('state_doing', 'started'),
  state('state_done', 'completed'),
];

function member(id: string, name: string): Member {
  return { id, name, email: `${id}@orbit.test`, image: null, handle: null, role: 'member' };
}

const members: readonly Member[] = [
  member('user_cy', 'Cy Diaz'),
  member('user_ada', 'Ada Lovelace'),
  member('user_bo', 'Bo Chen'),
];

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user_ada',
  teams: [{ id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
  states,
  labels: [],
  members,
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map(states.map((entry) => [entry.id, entry])),
  labelById: new Map(),
  memberById: new Map(members.map((entry) => [entry.id, entry])),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { StandupBoard } = await import('../../../src/features/standup/standup-board.tsx');

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship the board',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_ada',
    assigneeId: 'user_ada',
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    sortOrder: 1024,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    stateEnteredAt: '2026-06-08T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

const boardIssues: readonly Issue[] = [
  issue({
    id: 'issue_done',
    identifier: 'ENG-1',
    title: 'Land the importer',
    stateId: 'state_done',
  }),
  issue({
    id: 'issue_doing',
    identifier: 'ENG-2',
    title: 'Wire the socket',
    stateId: 'state_doing',
  }),
  issue({
    id: 'issue_next',
    identifier: 'ENG-3',
    title: 'Draft the schema',
    stateId: 'state_todo',
  }),
  issue({
    id: 'issue_bo',
    identifier: 'ENG-9',
    title: 'Trim the payload',
    stateId: 'state_doing',
    assigneeId: 'user_bo',
  }),
];

const originalFetch = globalThis.fetch;
const boardRequests: string[] = [];

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('/api/standup/board')) boardRequests.push(url);
    return Promise.resolve(
      Response.json({
        since: '2026-06-08T00:00:00.000Z',
        issues: boardIssues,
        workload: [
          { userId: 'user_ada', open: 2, inProgress: 1, completedSince: 1 },
          { userId: 'user_bo', open: 1, inProgress: 1, completedSince: 0 },
        ],
      }),
    );
  }) as unknown as typeof fetch;
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <HotkeyProvider>{children}</HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

async function mountBoard() {
  render(
    <Providers>
      <StandupBoard />
    </Providers>,
  );
  await screen.findByTestId('standup-tiles');
}

function activeName(): string {
  return screen.getByTestId('standup-person').textContent ?? '';
}

beforeEach(() => {
  boardRequests.length = 0;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.module('@/features/issues/issue-peek.tsx', () => ({ IssuePeek: realIssuePeek }));
});

describe('StandupBoard', () => {
  it('seats every workspace member in the tile row, alphabetically', async () => {
    await mountBoard();

    const tiles = within(screen.getByTestId('standup-tiles')).getAllByRole('button');
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual([
      'standup-tile-user_ada',
      'standup-tile-user_bo',
      'standup-tile-user_cy',
    ]);
    expect(screen.getByTestId('standup-position').textContent).toBe('1 of 3');
  });

  it('splits the first person work into closed, in progress and up next', async () => {
    await mountBoard();

    expect(activeName()).toBe('Ada Lovelace');
    expect(screen.getByTestId('standup-column-closed').textContent).toContain('ENG-1');
    expect(screen.getByTestId('standup-column-in-flight').textContent).toContain('ENG-2');
    expect(screen.getByTestId('standup-column-up-next').textContent).toContain('ENG-3');
    expect(screen.getByTestId('standup-column-closed').textContent).not.toContain('ENG-9');
  });

  it('swaps the panel on a tile click without asking the server again', async () => {
    await mountBoard();
    expect(boardRequests).toHaveLength(1);

    fireEvent.click(screen.getByTestId('standup-tile-user_bo'));

    expect(activeName()).toBe('Bo Chen');
    expect(screen.getByTestId('standup-column-in-flight').textContent).toContain('ENG-9');
    expect(boardRequests).toHaveLength(1);
  });

  it('walks the roster with the arrow keys and still issues no request', async () => {
    const user = userEvent.setup();
    await mountBoard();

    await user.keyboard('{ArrowRight}');
    expect(activeName()).toBe('Bo Chen');
    expect(screen.getByTestId('standup-position').textContent).toBe('2 of 3');

    await user.keyboard('{ArrowRight}');
    expect(activeName()).toBe('Cy Diaz');

    await user.keyboard('{ArrowLeft}');
    expect(activeName()).toBe('Bo Chen');

    expect(boardRequests).toHaveLength(1);
  });

  it('stops at the ends of the roster instead of wrapping past them', async () => {
    const user = userEvent.setup();
    await mountBoard();

    await user.keyboard('{ArrowLeft}');
    expect(activeName()).toBe('Ada Lovelace');

    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(activeName()).toBe('Cy Diaz');
  });

  it('links a standup row to its issue page and peeks it in place on a plain click', async () => {
    await mountBoard();

    const row = within(screen.getByTestId('issue-row-ENG-2'));
    const title = row.getByRole('link', { name: 'Wire the socket' });
    expect(title.getAttribute('href')).toBe('/issue/ENG-2');

    const leftTheBoard = fireEvent.click(title);

    expect(leftTheBoard).toBe(false);
    expect((await screen.findByTestId('issue-peek')).textContent).toBe('ENG-2');
  });

  it('peeks the focused row when the presenter presses space', async () => {
    const user = userEvent.setup();
    await mountBoard();

    const title = within(screen.getByTestId('issue-row-ENG-3')).getByRole('link', {
      name: 'Draft the schema',
    });
    title.focus();
    await user.keyboard(' ');

    expect((await screen.findByTestId('issue-peek')).textContent).toBe('ENG-3');
  });

  it('leaves the arrow keys to the peek while it is open', async () => {
    const user = userEvent.setup();
    await mountBoard();

    fireEvent.click(within(screen.getByTestId('issue-row-ENG-2')).getByText('Wire the socket'));
    await screen.findByTestId('issue-peek');

    await user.keyboard('{ArrowRight}');

    expect(activeName()).toBe('Ada Lovelace');
  });

  it('shows the timer only after the presenter asks for it', async () => {
    const user = userEvent.setup();
    await mountBoard();

    expect(screen.queryByTestId('standup-timer')).toBeNull();

    await user.keyboard('t');
    await waitFor(() => expect(screen.getByTestId('standup-timer')).toBeDefined());

    await user.keyboard('t');
    await waitFor(() => expect(screen.queryByTestId('standup-timer')).toBeNull());
  });

  it('leaves the timer to the peek while it is open', async () => {
    const user = userEvent.setup();
    await mountBoard();

    fireEvent.click(within(screen.getByTestId('issue-row-ENG-2')).getByText('Wire the socket'));
    await screen.findByTestId('issue-peek');

    await user.keyboard('t');

    expect(screen.queryByTestId('standup-timer')).toBeNull();
  });

  it('restarts the timer when the presenter moves to the next person', async () => {
    const user = userEvent.setup();
    await mountBoard();

    await user.keyboard('t');
    await waitFor(() => expect(screen.getByTestId('standup-timer')).toBeDefined());
    const first = screen.getByTestId('standup-timer').textContent;

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByTestId('standup-timer')).toBeDefined());

    expect(screen.getByTestId('standup-timer').textContent).toBe(first);
  });

  it('reads the whole meeting out of a single board request', async () => {
    const user = userEvent.setup();
    await mountBoard();

    fireEvent.click(screen.getByTestId('standup-tile-user_cy'));
    await user.keyboard('{ArrowLeft}');
    fireEvent.click(screen.getByTestId('standup-tile-user_ada'));

    expect(boardRequests).toHaveLength(1);
  });
});
