import { describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
  client.setQueryData(queryKeys.allIssues(allIssuesSearch()), {
    pages: [
      { issues: issues.slice(0, 2), nextCursor: null },
      { issues: issues.slice(2), nextCursor: null },
    ],
    pageParams: [null, 'cursor-1'],
  });
  return client;
}

function renderStandup(
  layout: 'list' | 'board',
  client: QueryClient = seededClient([
    issue({ id: 'a', identifier: 'ENG-1', assigneeId: 'me', sortOrder: 200 }),
    issue({ id: 'b', identifier: 'ENG-2', assigneeId: 'you' }),
    issue({ id: 'c', identifier: 'DES-9', teamId: 'team_des', assigneeId: null, sortOrder: 10 }),
  ]),
): void {
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HotkeyProvider>
          <StandupView layout={layout} />
        </HotkeyProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('StandupView', () => {
  it('shows every team and project issue regardless of who they belong to', () => {
    workspace = buildWorkspace();
    renderStandup('list');

    expect(screen.getByTestId('issue-row-ENG-1')).toBeInTheDocument();
    expect(screen.getByTestId('issue-row-ENG-2')).toBeInTheDocument();
    expect(screen.getByTestId('issue-row-DES-9')).toBeInTheDocument();
    expect(screen.getByTestId('issue-count')).toHaveTextContent('3');
  });

  it('defaults to grouping by project rather than per-team state', () => {
    workspace = buildWorkspace();
    renderStandup('list');

    expect(screen.getByTestId('issue-group-No project')).toBeInTheDocument();
    expect(screen.queryByTestId('issue-group-Todo')).toBeNull();
  });

  it('renders every issue as a card in the board layout', () => {
    workspace = buildWorkspace();
    renderStandup('board');

    expect(screen.queryByTestId('standup-list')).toBeNull();
    expect(screen.getByTestId('issue-card-ENG-1')).toBeInTheDocument();
    expect(screen.getByTestId('issue-card-DES-9')).toBeInTheDocument();
  });

  it('shows the empty state when no issues exist anywhere', () => {
    workspace = buildWorkspace();
    renderStandup('list', seededClient([]));

    expect(screen.queryByTestId('standup-list')).toBeNull();
    expect(screen.getByText('No issues yet')).toBeInTheDocument();
  });
});
