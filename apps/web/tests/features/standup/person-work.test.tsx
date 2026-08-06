import { describe, expect, it, mock } from 'bun:test';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { createQueryClient } from '@/lib/query/provider.tsx';
import type { Issue, Member, StandupWorkload, WorkflowState } from '@/lib/query/schemas.ts';

function state(id: string, category: string): WorkflowState {
  return { id, teamId: 'team_eng', name: id, category, color: '#666666', position: 0 };
}

const states: readonly WorkflowState[] = [
  state('state_todo', 'unstarted'),
  state('state_doing', 'started'),
  state('state_done', 'completed'),
];

const ada: Member = {
  id: 'user_ada',
  name: 'Ada Lovelace',
  email: 'ada@orbit.test',
  image: null,
  handle: 'ada',
  role: 'member',
};

const workspace: WorkspaceData = {
  ready: true,
  userId: 'user_ada',
  teams: [{ id: 'team_eng', name: 'Engineering', key: 'ENG', icon: 'circle', color: '#5a63c8' }],
  states,
  labels: [],
  members: [ada],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map(states.map((entry) => [entry.id, entry])),
  labelById: new Map(),
  memberById: new Map([[ada.id, ada]]),
  openQuickCreate: () => undefined,
};

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { PersonWork } = await import('../../../src/features/standup/person-work.tsx');

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

function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;
}

interface RenderOptions {
  readonly closed?: readonly Issue[];
  readonly inFlight?: readonly Issue[];
  readonly upNext?: readonly Issue[];
  readonly workload?: StandupWorkload | undefined;
  readonly onPeek?: (issueId: string) => void;
}

function renderWork(options: RenderOptions = {}) {
  const onPeek = options.onPeek ?? mock();
  render(
    <Providers>
      <PersonWork
        member={ada}
        buckets={{
          closed: options.closed ?? [],
          inFlight: options.inFlight ?? [],
          upNext: options.upNext ?? [],
        }}
        workload={options.workload}
        sinceLabel="since Friday"
        peekId={null}
        onPeek={onPeek}
      />
    </Providers>,
  );
  return onPeek;
}

describe('PersonWork', () => {
  it('names the person and reads the exact server counts', () => {
    renderWork({
      inFlight: [issue({ id: 'a', identifier: 'ENG-1', stateId: 'state_doing' })],
      workload: { userId: 'user_ada', open: 9, inProgress: 3, completedSince: 4 },
    });

    expect(screen.getByTestId('standup-person').textContent).toBe('Ada Lovelace');
    expect(screen.getByTestId('standup-person-summary').textContent).toBe('3 in progress, 9 open');
  });

  it('heads the closed column with the window label and the server count', () => {
    renderWork({
      closed: [issue({ id: 'a', identifier: 'ENG-1', stateId: 'state_done' })],
      workload: { userId: 'user_ada', open: 2, inProgress: 1, completedSince: 6 },
    });

    const column = screen.getByTestId('standup-column-closed');
    expect(within(column).getByRole('heading').textContent).toBe('Closed since Friday');
    expect(column.textContent).toContain('6');
  });

  it('says how much of a capped column it is showing rather than hiding the rest', () => {
    renderWork({
      inFlight: [
        issue({ id: 'a', identifier: 'ENG-1', stateId: 'state_doing' }),
        issue({ id: 'b', identifier: 'ENG-2', stateId: 'state_doing' }),
      ],
      workload: { userId: 'user_ada', open: 41, inProgress: 25, completedSince: 0 },
    });

    expect(screen.getByTestId('standup-column-in-flight-capped').textContent).toBe(
      'showing 2 of 25',
    );
    expect(screen.getByTestId('standup-column-up-next-capped').textContent).toBe('showing 0 of 16');
  });

  it('stays quiet when a column holds everything the person owns', () => {
    renderWork({
      inFlight: [issue({ id: 'a', identifier: 'ENG-1', stateId: 'state_doing' })],
      workload: { userId: 'user_ada', open: 1, inProgress: 1, completedSince: 0 },
    });

    expect(screen.queryByTestId('standup-column-in-flight-capped')).toBeNull();
    expect(screen.queryByTestId('standup-column-closed-capped')).toBeNull();
  });

  it('never claims fewer rows than it renders when the counts disagree', () => {
    renderWork({
      closed: [
        issue({ id: 'a', identifier: 'ENG-1', stateId: 'state_done' }),
        issue({ id: 'b', identifier: 'ENG-2', stateId: 'state_done' }),
      ],
      workload: { userId: 'user_ada', open: 0, inProgress: 0, completedSince: 1 },
    });

    const column = screen.getByTestId('standup-column-closed');
    expect(within(column).queryByTestId('standup-column-closed-capped')).toBeNull();
    expect(column.textContent).toContain('2');
  });

  it('falls back to the rendered rows when the server sent no workload row', () => {
    renderWork({
      inFlight: [issue({ id: 'a', identifier: 'ENG-1', stateId: 'state_doing' })],
      upNext: [issue({ id: 'b', identifier: 'ENG-2', stateId: 'state_todo' })],
    });

    expect(screen.getByTestId('standup-person-summary').textContent).toBe('1 in progress, 2 open');
  });

  it('opens the peek for the issue that was clicked', () => {
    const onPeek = renderWork({
      upNext: [issue({ id: 'issue_up', identifier: 'ENG-7', stateId: 'state_todo' })],
    });

    fireEvent.click(within(screen.getByTestId('issue-row-ENG-7')).getByText('Ship the board'));

    expect(onPeek).toHaveBeenCalledWith('issue_up');
  });

  it('tells the presenter when a column is empty', () => {
    renderWork({});

    expect(screen.getByTestId('standup-column-closed').textContent).toContain(
      'Nothing closed yet.',
    );
    expect(screen.getByTestId('standup-column-in-flight').textContent).toContain(
      'Nothing in progress.',
    );
    expect(screen.getByTestId('standup-column-up-next').textContent).toContain('Nothing queued.');
  });
});
