import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { groupIssues } from '@/features/filters/grouping.ts';
import type { Issue, Label, Member, WorkflowState } from '@/lib/query/schemas.ts';
import { planDrop } from './board.tsx';
import { IssueCard } from './issue-card.tsx';

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

  it('links to the issue and lifts while dragging', () => {
    const { rerender } = render(<IssueCard issue={issue()} labels={[]} assignee={undefined} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/issue/ENG-4');

    const card = screen.getByTestId('issue-card-ENG-4');
    expect(card.className).not.toContain('-translate-y-0.5');

    rerender(<IssueCard issue={issue()} labels={[]} assignee={undefined} dragging />);
    expect(screen.getByTestId('issue-card-ENG-4').className).toContain('-translate-y-0.5');
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
    const plan = planDrop(columns, issues, 'a', 'state_doing');
    expect(plan).toMatchObject({ stateId: 'state_doing', beforeId: 'c', afterId: null });
    expect(plan?.beforeOrder).toBe(1024);
  });

  it('places a card between the neighbours it was dropped onto', () => {
    const plan = planDrop(columns, issues, 'c', 'b');
    expect(plan).toMatchObject({
      stateId: 'state_todo',
      beforeId: 'a',
      afterId: 'b',
      beforeOrder: 1024,
      afterOrder: 2048,
    });
  });

  it('ignores a drop on itself or on an unknown target', () => {
    expect(planDrop(columns, issues, 'a', 'a')).toBeNull();
    expect(planDrop(columns, issues, 'a', 'nowhere')).toBeNull();
  });
});
