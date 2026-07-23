import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query/keys.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import type { WorkspaceData } from './workspace-provider.tsx';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let workspace: WorkspaceData;
vi.mock('./workspace-provider.tsx', () => ({ useWorkspace: () => workspace }));

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

function renderView(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  client.setQueryData(queryKeys.issues('team_eng'), [
    issue({ id: 'a', identifier: 'ENG-1', assigneeId: 'me', sortOrder: 200 }),
    issue({ id: 'b', identifier: 'ENG-2', assigneeId: 'you' }),
  ]);
  client.setQueryData(queryKeys.issues('team_des'), [
    issue({ id: 'c', identifier: 'DES-9', teamId: 'team_des', assigneeId: 'me', sortOrder: 10 }),
  ]);
  render(
    <QueryClientProvider client={client}>
      <MyIssuesView />
    </QueryClientProvider>,
  );
}

describe('MyIssuesView', () => {
  it('merges every team query and renders only the viewer rows', () => {
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

  it('shows the empty state when nothing is assigned to the viewer', () => {
    workspace = { ...buildWorkspace(), userId: 'nobody' };
    renderView();

    expect(screen.queryByTestId('my-issues-list')).toBeNull();
    expect(screen.getByText('Nothing assigned to you')).toBeInTheDocument();
  });
});
