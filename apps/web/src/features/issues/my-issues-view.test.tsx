import { describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { assignedSearch } from '@/lib/query/use-issues.ts';
import type { WorkspaceData } from './workspace-provider.tsx';
import * as workspaceProvider from './workspace-provider.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock() }),
  usePathname: () => '/my-issues',
  useSearchParams: () => new URLSearchParams(),
}));

let workspace: WorkspaceData;
mock.module('./workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { MyIssuesView, assignedTo } = await import('./my-issues-view.tsx');

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_eng',
    number: 1,
    identifier: 'ENG-1',
    title: 'Ship it',
    description: '',
    stateId: 'state_todo',
    priority: 0,
    creatorId: 'user_1',
    assigneeId: null,
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
    stateEnteredAt: '2026-01-01T00:00:00.000Z',
    syncId: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    labelIds: [],
    ...overrides,
  };
}

describe('assignedTo', () => {
  it('keeps only the viewer issues and orders them', () => {
    const rows = assignedTo(
      [
        issue({ id: 'a', identifier: 'ENG-1', assigneeId: 'me', sortOrder: 200 }),
        issue({ id: 'b', identifier: 'DES-1', teamId: 'team_des', assigneeId: 'you' }),
        issue({
          id: 'c',
          identifier: 'DES-2',
          teamId: 'team_des',
          assigneeId: 'me',
          sortOrder: 10,
        }),
      ],
      'me',
    );
    expect(rows.map((row) => row.identifier)).toEqual(['DES-2', 'ENG-1']);
  });

  it('returns nothing before the viewer is known', () => {
    expect(assignedTo([issue({ assigneeId: 'me' })], null)).toEqual([]);
  });
});

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_eng',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 2,
};

function buildWorkspace(): WorkspaceData {
  return {
    ready: true,
    userId: 'me',
    teams: [
      { id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5b6cf9' },
      { id: 'team_des', name: 'Design', key: 'DES', icon: 'circle', color: '#f95b6c' },
    ],
    states: [todo],
    labels: [],
    members: [],
    projects: [],
    cycles: [],
    seedIssues: [],
    stateById: new Map([[todo.id, todo]]),
    labelById: new Map(),
    memberById: new Map(),
    openQuickCreate: () => undefined,
  };
}

function renderEmptyCacheView(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <MyIssuesView />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderView(viewerId = 'me'): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.assignedIssues(viewerId, assignedSearch(viewerId)), {
    pages: [
      {
        issues: [
          issue({ id: 'a', identifier: 'ENG-1', assigneeId: 'me', sortOrder: 200 }),
          issue({ id: 'b', identifier: 'ENG-2', assigneeId: 'you' }),
        ],
        nextCursor: null,
      },
      {
        issues: [
          issue({
            id: 'c',
            identifier: 'DES-9',
            teamId: 'team_des',
            assigneeId: 'me',
            sortOrder: 10,
          }),
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null, 'cursor-1'],
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <MyIssuesView />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('MyIssuesView', () => {
  it('merges every loaded page and renders only the viewer rows', () => {
    workspace = buildWorkspace();
    renderView();

    expect(screen.getByTestId('issue-row-DES-9')).toBeInTheDocument();
    expect(screen.getByTestId('issue-row-ENG-1')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-row-ENG-2')).toBeNull();

    const rendered = screen
      .getAllByTestId(/^issue-row-/)
      .map((row) => row.getAttribute('data-testid'));
    expect(rendered).toEqual(['issue-row-DES-9', 'issue-row-ENG-1']);
  });

  it('shows the loading state while the team queries are still pending', () => {
    workspace = buildWorkspace();
    renderEmptyCacheView();

    expect(screen.getByText('Loading your issues')).toBeInTheDocument();
    expect(screen.queryByText('Nothing assigned to you')).toBeNull();
    expect(screen.queryByTestId('my-issues-list')).toBeNull();
  });

  it('shows the empty state when nothing is assigned to the viewer', () => {
    workspace = { ...buildWorkspace(), userId: 'nobody' };
    renderView('nobody');

    expect(screen.queryByTestId('my-issues-list')).toBeNull();
    expect(screen.getByText('Nothing assigned to you')).toBeInTheDocument();
  });

  it('groups the rows so the display options have something to act on', () => {
    workspace = buildWorkspace();
    renderView();

    expect(screen.getByTestId('issue-group-Todo')).toBeInTheDocument();
  });

  it('opens the peek panel when a row is clicked instead of navigating away', () => {
    workspace = buildWorkspace();
    renderView();

    expect(screen.queryByTestId('issue-peek')).toBeNull();
    const row = screen.getByTestId('issue-row-ENG-1');
    act(() => {
      fireEvent.click(within(row).getByRole('button', { name: 'Ship it' }));
    });
    expect(screen.getByTestId('issue-peek')).toBeInTheDocument();
  });
});
