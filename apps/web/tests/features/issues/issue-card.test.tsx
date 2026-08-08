import { describe, expect, it } from 'bun:test';
import type { DisplayProperty } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES, DISPLAY_PROPERTIES } from '@orbit/shared/filters';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as renderRaw, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { groupIssues } from '@/features/filters/grouping.ts';
import type { Issue, Label, Member, WorkflowState } from '@/lib/query/schemas.ts';
import { planDrop } from '../../../src/features/issues/board.tsx';
import { IssueCard } from '../../../src/features/issues/issue-card.tsx';

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactElement) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>
  );
  const result = renderRaw(wrap(ui));
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 4,
    identifier: 'ENG-4',
    title: 'Presence should expire after 45 seconds',
    description: '',
    stateId: 'state_todo',
    priority: 1,
    creatorId: 'user_1',
    assigneeId: 'user_2',
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    estimate: 5,
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
    labelIds: ['label_1'],
    ...overrides,
  };
}

const label: Label = { id: 'label_1', teamId: null, name: 'Bug', color: '#cc4b4b' };
const member: Member = {
  id: 'user_2',
  name: 'Aditi Rao',
  email: 'aditi@noveum.ai',
  image: null,
  handle: 'aditi',
  role: 'member',
};

describe('IssueCard', () => {
  it('shows the identifier, title, estimate, label and assignee', async () => {
    render(<IssueCard issue={issue()} labels={[label]} assignee={member} />);

    expect(screen.getByText('ENG-4')).toBeInTheDocument();
    expect(screen.getByText('Presence should expire after 45 seconds')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByLabelText('Urgent')).toBeInTheDocument();
    expect(await screen.findByText('AR')).toBeInTheDocument();
  });

  it('links to the issue and marks itself while being dragged, without moving the layout', () => {
    const { rerender } = render(<IssueCard issue={issue()} labels={[]} assignee={undefined} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/issue/ENG-4');

    const card = screen.getByTestId('issue-card-ENG-4');
    expect(card.className).not.toContain('shadow-pop');

    rerender(<IssueCard issue={issue()} labels={[]} assignee={undefined} dragging />);
    const dragged = screen.getByTestId('issue-card-ENG-4');
    expect(dragged.className).toContain('shadow-pop');
    expect(dragged.className).toContain('cursor-grabbing');
    expect(dragged.className).not.toContain('rotate-');
  });
});

const state: WorkflowState = {
  id: 'state_todo',
  teamId: 'team_1',
  name: 'In progress',
  category: 'started',
  color: '#f2c94c',
  position: 1,
};
const creator: Member = {
  id: 'user_9',
  name: 'Ravi Kapoor',
  email: 'ravi@noveum.ai',
  image: null,
  handle: 'ravi',
  role: 'member',
};
const project = { name: 'Website', color: '#2f80ed' };
const cycle = { name: 'Cycle 7' };

function fullCard(properties: readonly DisplayProperty[]) {
  return (
    <IssueCard
      issue={issue({
        milestoneId: 'ms_1',
        dueDate: '2026-03-04T00:00:00.000Z',
        startedAt: '2026-03-01T00:00:00.000Z',
        completedAt: '2026-03-05T00:00:00.000Z',
      })}
      labels={[label]}
      assignee={member}
      state={state}
      creator={creator}
      project={project}
      cycle={cycle}
      subIssueCount={2}
      properties={properties}
    />
  );
}

describe('IssueCard display properties', () => {
  it('renders every property that is toggled on', async () => {
    render(fullCard([...DISPLAY_PROPERTIES]));

    expect(screen.getByLabelText('Urgent')).toBeInTheDocument();
    expect(screen.getByLabelText('In progress')).toBeInTheDocument();
    expect(screen.getByText('ENG-4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByTitle('Sub-issues')).toHaveTextContent('2');
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('Cycle 7')).toBeInTheDocument();
    expect(screen.getByTitle('On a milestone')).toBeInTheDocument();
    expect(screen.getByTitle('Due date')).toBeInTheDocument();
    expect(screen.getByTitle('Started')).toBeInTheDocument();
    expect(screen.getByTitle('Completed')).toBeInTheDocument();
    expect(screen.getByTitle('Created')).toBeInTheDocument();
    expect(screen.getByTitle('Updated')).toBeInTheDocument();
    expect(await screen.findByText('RK')).toBeInTheDocument();
    expect(await screen.findByText('AR')).toBeInTheDocument();
  });

  it('hides every property that is toggled off', () => {
    render(fullCard([]));

    expect(screen.getByText('Presence should expire after 45 seconds')).toBeInTheDocument();
    expect(screen.queryByLabelText('Urgent')).toBeNull();
    expect(screen.queryByLabelText('In progress')).toBeNull();
    expect(screen.queryByText('ENG-4')).toBeNull();
    expect(screen.queryByText('Bug')).toBeNull();
    expect(screen.queryByTitle('Sub-issues')).toBeNull();
    expect(screen.queryByTitle('Project')).toBeNull();
    expect(screen.queryByTitle('Cycle')).toBeNull();
    expect(screen.queryByTitle('On a milestone')).toBeNull();
    expect(screen.queryByTitle('Due date')).toBeNull();
    expect(screen.queryByTitle('Created')).toBeNull();
  });
});

describe('board placement', () => {
  const states: WorkflowState[] = [
    {
      id: 'state_todo',
      teamId: 'team_1',
      name: 'Todo',
      category: 'unstarted',
      color: '#000000',
      position: 0,
    },
    {
      id: 'state_doing',
      teamId: 'team_1',
      name: 'Doing',
      category: 'started',
      color: '#000000',
      position: 1,
    },
  ];
  const issues = [
    issue({ id: 'a', identifier: 'ENG-1', sortOrder: 1024 }),
    issue({ id: 'b', identifier: 'ENG-2', sortOrder: 2048 }),
    issue({ id: 'c', identifier: 'ENG-3', stateId: 'state_doing', sortOrder: 1024 }),
  ];
  const columns = groupIssues(
    issues,
    'state',
    { states, members: [], projects: [], cycles: [], labels: [] },
    { showEmptyGroups: true, ordering: 'manual' },
  );

  it('groups issues into their state column in sort order', () => {
    expect(columns[0]?.issues.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(columns[1]?.issues.map((entry) => entry.id)).toEqual(['c']);
  });

  it('places a card dropped on an empty column at the end', () => {
    const plan = planDrop(columns, issues, 'a', 'state_doing', 'state');
    expect(plan).toMatchObject({ stateId: 'state_doing', beforeId: 'c', afterId: null });
    expect(plan?.beforeOrder).toBe(1024);
  });

  it('places a card between the neighbours it was dropped onto', () => {
    const plan = planDrop(columns, issues, 'c', 'b', 'state');
    expect(plan).toMatchObject({
      stateId: 'state_todo',
      beforeId: 'a',
      afterId: 'b',
      beforeOrder: 1024,
      afterOrder: 2048,
    });
  });

  it('ignores a drop on itself or on an unknown target', () => {
    expect(planDrop(columns, issues, 'a', 'a', 'state')).toBeNull();
    expect(planDrop(columns, issues, 'a', 'nowhere', 'state')).toBeNull();
  });
});

describe('card controls', () => {
  it('offers the priority and status as buttons a facilitator can press', () => {
    render(<IssueCard issue={issue()} labels={[]} assignee={undefined} state={state} />);

    const priority = screen.getByTestId('card-priority-ENG-4');
    const status = screen.getByTestId('card-status-ENG-4');
    expect(priority.tagName).toBe('BUTTON');
    expect(status.tagName).toBe('BUTTON');
    expect(priority).toHaveAttribute('aria-label', 'Priority: Urgent');
    expect(status).toHaveAttribute('aria-label', 'Status: In progress');
  });

  it('falls back to a plain glyph while the card is being dragged', () => {
    render(<IssueCard issue={issue()} labels={[]} assignee={undefined} state={state} dragging />);
    expect(screen.queryByTestId('card-priority-ENG-4')).toBeNull();
    expect(screen.queryByTestId('card-status-ENG-4')).toBeNull();
    expect(screen.getByLabelText('Urgent')).toBeInTheDocument();
  });

  it('carries the properties a board reader expects by default', () => {
    expect([...DEFAULT_DISPLAY_PROPERTIES]).toEqual(
      expect.arrayContaining(['priority', 'status', 'labels', 'project', 'created', 'assignee']),
    );
  });
});

describe('planDrop across merged state columns', () => {
  const states = [
    {
      id: 'eng_todo',
      teamId: 'team_eng',
      name: 'Todo',
      category: 'unstarted',
      color: '#000000',
      position: 0,
    },
    {
      id: 'des_todo',
      teamId: 'team_des',
      name: 'Todo',
      category: 'unstarted',
      color: '#000000',
      position: 0,
    },
  ];

  const merged = [
    {
      id: 'unstarted:todo',
      title: 'Todo',
      category: 'unstarted',
      color: '#000000',
      issues: [] as ReturnType<typeof issue>[],
      total: 0,
      subGroups: [],
    },
  ];

  function resolveState(groupId: string, dragged: { teamId: string }): string | null {
    const found = states.find(
      (state) =>
        state.teamId === dragged.teamId &&
        `${state.category}:${state.name.trim().toLowerCase()}` === groupId,
    );
    return found?.id ?? null;
  }

  it('lands on the state belonging to the team of the issue being dragged', () => {
    const dragged = issue({ id: 'a', identifier: 'ENG-1', teamId: 'team_eng' });
    const plan = planDrop(merged, [dragged], 'a', 'unstarted:todo', 'state', resolveState);

    expect(plan).toMatchObject({ stateId: 'eng_todo' });
  });

  it('picks a different team own state for the same column', () => {
    const dragged = issue({ id: 'b', identifier: 'DES-1', teamId: 'team_des' });
    const plan = planDrop(merged, [dragged], 'b', 'unstarted:todo', 'state', resolveState);

    expect(plan).toMatchObject({ stateId: 'des_todo' });
  });

  it('refuses the drop when the team has no state for that column', () => {
    const dragged = issue({ id: 'c', identifier: 'MKT-1', teamId: 'team_mkt' });

    expect(planDrop(merged, [dragged], 'c', 'unstarted:todo', 'state', resolveState)).toBeNull();
  });

  it('still uses the column id itself when no resolver is given', () => {
    const dragged = issue({ id: 'a', identifier: 'ENG-1', teamId: 'team_eng' });
    const plan = planDrop(merged, [dragged], 'a', 'unstarted:todo', 'state');

    expect(plan).toMatchObject({ stateId: 'unstarted:todo' });
  });
});
