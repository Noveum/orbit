import { describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import * as issuesQuery from '@/lib/query/use-issues.ts';
import { IssueList } from './issue-list.tsx';
import type { WorkspaceData } from './workspace-provider.tsx';
import * as workspaceProvider from './workspace-provider.tsx';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/team/eng/issues',
}));

mock.module('@/lib/query/use-issues.ts', () => ({
  ...issuesQuery,
  useUpdateIssue: () => ({ mutate: mock(), isPending: false }),
}));

const todo: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 1,
};

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 1,
    identifier: 'ENG-1',
    title: 'Domain auto join',
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

const issues = [issue(), issue({ id: 'issue_2', number: 2, identifier: 'ENG-2', sortOrder: 2048 })];

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user_1',
  teams: [{ id: 'team_1', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
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

mock.module('./workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

function renderList() {
  const groups = groupIssues(
    issues,
    'state',
    { states: [todo], members: [], projects: [], cycles: [], labels: [] },
    { showEmptyGroups: false, ordering: 'manual' },
  );
  render(
    <HotkeyProvider>
      <IssueList teamId="team_1" states={[todo]} groups={groups} />
    </HotkeyProvider>,
  );
}

describe('the first issue is active on arrival', () => {
  it('selects without needing a j or k first', async () => {
    const user = userEvent.setup();
    renderList();

    await user.keyboard('x');

    expect(await screen.findByTestId('bulk-edit-bar')).toBeInTheDocument();
  });
});

describe('escape on the issue list', () => {
  it('closes the peek first and keeps the selection', async () => {
    const user = userEvent.setup();
    renderList();

    await user.keyboard('jx');
    expect(await screen.findByTestId('bulk-edit-bar')).toBeInTheDocument();

    await user.keyboard('[Space]');
    expect(await screen.findByTestId('issue-peek')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('issue-peek')).not.toBeInTheDocument());
    expect(screen.getByTestId('bulk-edit-bar')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('bulk-edit-bar')).not.toBeInTheDocument());
  });
});
