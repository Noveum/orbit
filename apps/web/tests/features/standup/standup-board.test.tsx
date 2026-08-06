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
import type { Issue, Member, StandupWorkload, WorkflowState } from '@/lib/query/schemas.ts';

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
    id: 'issue_next',
    identifier: 'ENG-3',
    title: 'Draft the schema',
    stateId: 'state_todo',
  }),
  issue({
    id: 'issue_doing',
    identifier: 'ENG-2',
    title: 'Wire the socket',
    stateId: 'state_doing',
  }),
  issue({
    id: 'issue_bo',
    identifier: 'ENG-9',
    title: 'Trim the payload',
    stateId: 'state_doing',
    assigneeId: 'user_bo',
  }),
];

const boardWorkload: readonly StandupWorkload[] = [
  { userId: 'user_ada', open: 2, inProgress: 1, completedSince: 1 },
  { userId: 'user_bo', open: 1, inProgress: 1, completedSince: 0 },
];

const originalFetch = globalThis.fetch;
const boardRequests: string[] = [];

interface BoardResponse {
  readonly issues: readonly Issue[];
  readonly workload: readonly StandupWorkload[];
}

let response: BoardResponse = { issues: boardIssues, workload: boardWorkload };

function stubFetch(): void {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith('/api/standup/board')) boardRequests.push(url);
    return Promise.resolve(
      Response.json({
        since: '2026-06-08T00:00:00.000Z',
        issues: response.issues,
        workload: response.workload,
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
  await screen.findByTestId('standup-columns');
}

function columnNames(): string[] {
  return within(screen.getByTestId('standup-columns'))
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent ?? '');
}

function cardsIn(userId: string): string[] {
  return within(screen.getByTestId(`standup-column-${userId}`))
    .getAllByRole('article')
    .map((card) => card.getAttribute('data-testid') ?? '');
}

beforeEach(() => {
  boardRequests.length = 0;
  response = { issues: boardIssues, workload: boardWorkload };
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
  it('gives every person with work a column headed by their name and avatar', async () => {
    await mountBoard();

    expect(columnNames()).toEqual(['Ada Lovelace', 'Bo Chen']);

    const ada = within(screen.getByTestId('standup-column-user_ada'));
    expect(ada.getByRole('img', { name: 'Ada Lovelace' })).toBeDefined();
  });

  it('shows everyone at once instead of behind a selection step', async () => {
    await mountBoard();

    expect(cardsIn('user_ada')).toContain('issue-card-ENG-2');
    expect(cardsIn('user_bo')).toEqual(['issue-card-ENG-9']);
  });

  it('drops a column for a person the window found no work for', async () => {
    await mountBoard();

    expect(screen.queryByTestId('standup-column-user_cy')).toBeNull();
  });

  it('stacks a column with what is in progress above what is queued and closed', async () => {
    await mountBoard();

    expect(cardsIn('user_ada')).toEqual([
      'issue-card-ENG-2',
      'issue-card-ENG-3',
      'issue-card-ENG-1',
    ]);
  });

  it('makes every card a real link to its issue page', async () => {
    await mountBoard();

    for (const identifier of ['ENG-1', 'ENG-2', 'ENG-3', 'ENG-9']) {
      const card = within(screen.getByTestId(`issue-card-${identifier}`));
      const link = card.getByRole('link');
      expect(link.tagName).toBe('A');
      expect(link.getAttribute('href')).toBe(`/issue/${identifier}`);
    }
  });

  it('peeks the issue in place on a plain click and stays on the board', async () => {
    await mountBoard();

    const title = within(screen.getByTestId('issue-card-ENG-9')).getByRole('link', {
      name: 'Trim the payload',
    });

    const leftTheBoard = fireEvent.click(title);

    expect(leftTheBoard).toBe(false);
    expect((await screen.findByTestId('issue-peek')).textContent).toBe('ENG-9');
  });

  it('peeks the focused card when a keyboard user presses space', async () => {
    const user = userEvent.setup();
    await mountBoard();

    within(screen.getByTestId('issue-card-ENG-3'))
      .getByRole('link', { name: 'Draft the schema' })
      .focus();
    await user.keyboard(' ');

    expect((await screen.findByTestId('issue-peek')).textContent).toBe('ENG-3');
  });

  it('lets a cmd click fall through to the link instead of peeking', async () => {
    await mountBoard();

    const title = within(screen.getByTestId('issue-card-ENG-2')).getByRole('link', {
      name: 'Wire the socket',
    });

    const followed = fireEvent.click(title, { metaKey: true });

    expect(followed).toBe(true);
    expect(screen.queryByTestId('issue-peek')).toBeNull();
  });

  it('owns up to the rows the server capped away rather than hiding them', async () => {
    response = {
      issues: boardIssues,
      workload: [
        { userId: 'user_ada', open: 12, inProgress: 4, completedSince: 3 },
        { userId: 'user_bo', open: 1, inProgress: 1, completedSince: 0 },
      ],
    };
    await mountBoard();

    expect(screen.getByTestId('standup-count-user_ada').textContent).toBe('3 of 15');
    expect(screen.getByTestId('standup-count-user_bo').textContent).toBe('1');
  });

  it('says nobody is on the board when the window came back empty', async () => {
    response = { issues: [], workload: [] };
    render(
      <Providers>
        <StandupBoard />
      </Providers>,
    );

    expect(await screen.findByText('Nobody has work on the board')).toBeDefined();
    expect(screen.queryByTestId('standup-columns')).toBeNull();
  });

  it('says which window the closed cards came out of', async () => {
    await mountBoard();

    expect(screen.getByTestId('standup-window').textContent).toMatch(/^closed work since \w/);
  });

  it('shows the timer only after the room asks for it', async () => {
    const user = userEvent.setup();
    await mountBoard();

    expect(screen.queryByTestId('standup-timer')).toBeNull();

    await user.keyboard('t');
    await waitFor(() => expect(screen.getByTestId('standup-timer')).toBeDefined());
    expect(screen.getByTestId('standup-timer').textContent).toMatch(/^\d+:[0-5]\d$/);

    await user.keyboard('t');
    await waitFor(() => expect(screen.queryByTestId('standup-timer')).toBeNull());
  });

  it('leaves the timer key to the peek while it is open', async () => {
    const user = userEvent.setup();
    await mountBoard();

    fireEvent.click(within(screen.getByTestId('issue-card-ENG-2')).getByText('Wire the socket'));
    await screen.findByTestId('issue-peek');

    await user.keyboard('t');

    expect(screen.queryByTestId('standup-timer')).toBeNull();
  });

  it('reads the whole meeting out of a single board request', async () => {
    await mountBoard();

    expect(boardRequests).toHaveLength(1);

    fireEvent.click(within(screen.getByTestId('issue-card-ENG-9')).getByText('Trim the payload'));
    expect((await screen.findByTestId('issue-peek')).textContent).toBe('ENG-9');

    fireEvent.click(within(screen.getByTestId('issue-card-ENG-2')).getByText('Wire the socket'));
    expect((await screen.findByTestId('issue-peek')).textContent).toBe('ENG-2');

    expect(boardRequests).toHaveLength(1);
  });
});
