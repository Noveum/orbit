import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { emptyFilterGroup } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { allIssuesSearch } from '@/lib/query/use-issues.ts';
import type { WorkspaceData } from './workspace-provider.tsx';
import * as workspaceProvider from './workspace-provider.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock() }),
  usePathname: () => '/standup',
  useSearchParams: () => new URLSearchParams(),
}));

let workspace: WorkspaceData;
mock.module('./workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { StandupView } = await import('./standup-view.tsx');

const DEFAULT_SEARCH = allIssuesSearch({ filter: emptyFilterGroup(), orderBy: 'manual' });

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

function seededClient(issues: readonly Issue[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.allIssues(DEFAULT_SEARCH), {
    pages: [
      { issues: issues.slice(0, 2), nextCursor: null },
      { issues: issues.slice(2), nextCursor: null },
    ],
    pageParams: [null, 'cursor-1'],
  });
  return client;
}

function renderStandup(
  issues: readonly Issue[] = [
    issue({ id: 'a', identifier: 'ENG-1', assigneeId: 'me', sortOrder: 200 }),
    issue({ id: 'b', identifier: 'ENG-2', assigneeId: 'you' }),
    issue({ id: 'c', identifier: 'DES-9', teamId: 'team_des', assigneeId: null, sortOrder: 10 }),
  ],
): void {
  render(
    <QueryClientProvider client={seededClient(issues)}>
      <ToastProvider>
        <HotkeyProvider>
          <StandupView />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  workspace = buildWorkspace();
});

afterEach(() => {
  cleanup();
});

describe('StandupView', () => {
  it('shows every team and project issue, grouped by project by default', () => {
    renderStandup();

    expect(screen.getByTestId('issue-row-ENG-1')).toBeInTheDocument();
    expect(screen.getByTestId('issue-row-ENG-2')).toBeInTheDocument();
    expect(screen.getByTestId('issue-row-DES-9')).toBeInTheDocument();
    expect(screen.getByTestId('issue-count')).toHaveTextContent('3');
    expect(screen.getByTestId('issue-group-No project')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-group-Todo')).toBeNull();
  });

  it('offers a filter bar but hides the workspace save-view button', () => {
    renderStandup();

    expect(screen.getByTestId('filter-bar')).toBeInTheDocument();
    expect(screen.getByTestId('add-filter')).toBeInTheDocument();
    expect(screen.queryByTestId('save-view')).toBeNull();
  });

  it('toggles between list and board layouts in place', () => {
    renderStandup();

    expect(screen.getByTestId('standup-list')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId('standup-board-toggle'));
    });
    expect(screen.queryByTestId('standup-list')).toBeNull();
    expect(screen.getByTestId('issue-card-ENG-1')).toBeInTheDocument();
  });

  it('keeps Save disabled until something changes, then persists and restores it', () => {
    renderStandup();

    expect(screen.getByTestId('save-standup')).toBeDisabled();

    act(() => {
      fireEvent.click(screen.getByTestId('standup-board-toggle'));
    });
    expect(screen.getByTestId('save-standup')).not.toBeDisabled();

    act(() => {
      fireEvent.click(screen.getByTestId('save-standup'));
    });
    expect(screen.getByTestId('save-standup')).toBeDisabled();
    expect(window.localStorage.getItem('orbit.standup.me')).toContain('"layout":"board"');

    cleanup();
    renderStandup();
    expect(screen.queryByTestId('standup-list')).toBeNull();
    expect(screen.getByTestId('issue-card-ENG-1')).toBeInTheDocument();
  });
});
