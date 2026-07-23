import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupContext } from '@/features/filters/grouping.ts';
import { groupIssues } from '@/features/filters/grouping.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { buildRows } from './issue-list.tsx';
import { IssueRow } from './issue-row.tsx';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue_1',
    organizationId: 'org_1',
    teamId: 'team_1',
    number: 7,
    identifier: 'ENG-7',
    title: 'Domain auto join for verified workspace domains',
    description: '',
    stateId: 'state_todo',
    priority: 3,
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
  teamId: 'team_1',
  name: 'Todo',
  category: 'unstarted',
  color: '#5d6272',
  position: 2,
};
const done: WorkflowState = {
  id: 'state_done',
  teamId: 'team_1',
  name: 'Done',
  category: 'completed',
  color: '#2e9e68',
  position: 5,
};

const groupContext: GroupContext = {
  states: [todo, done],
  members: [
    {
      id: 'user_2',
      name: 'Aditi Rao',
      email: 'aditi@noveum.ai',
      image: null,
      handle: 'aditi',
      role: 'member',
    },
  ],
  projects: [],
  cycles: [],
  labels: [],
};

describe('IssueRow', () => {
  it('opens on click and toggles selection from the checkbox', async () => {
    const user = userEvent.setup();
    const onOpen = mock();
    const onToggleSelected = mock();

    render(
      <IssueRow
        issue={issue()}
        state={todo}
        labels={[]}
        assignee={undefined}
        active={false}
        selected={false}
        onOpen={onOpen}
        onToggleSelected={onToggleSelected}
        onFocus={mock()}
      />,
    );

    await user.click(screen.getByText('Domain auto join for verified workspace domains'));
    expect(onOpen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText('Select ENG-7'));
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
  });

  it('marks the active row', () => {
    render(
      <IssueRow
        issue={issue()}
        state={todo}
        labels={[]}
        assignee={undefined}
        active
        selected={false}
        onOpen={mock()}
        onToggleSelected={mock()}
        onFocus={mock()}
      />,
    );
    expect(screen.getByTestId('issue-row-ENG-7')).toHaveAttribute('data-active', 'true');
  });
});

describe('buildRows', () => {
  const stateById = new Map([
    [todo.id, todo],
    [done.id, done],
  ]);

  function rowsFor(issues: Issue[]) {
    return buildRows(
      groupIssues(issues, 'state', groupContext, { showEmptyGroups: false, ordering: 'manual' }),
      stateById,
    );
  }

  it('emits a header per non empty group followed by its issues', () => {
    const rows = rowsFor([
      issue({ id: 'a', identifier: 'ENG-1', sortOrder: 2048 }),
      issue({ id: 'b', identifier: 'ENG-2', sortOrder: 1024 }),
      issue({ id: 'c', identifier: 'ENG-3', stateId: 'state_done' }),
    ]);

    expect(rows.map((row) => row.kind)).toEqual(['header', 'issue', 'issue', 'header', 'issue']);
    expect(rows[0]?.kind === 'header' ? rows[0].group.issues.length : 0).toBe(2);
    expect(rows[1]?.kind === 'issue' ? rows[1].issue.identifier : '').toBe('ENG-2');
  });

  it('skips groups with no issues', () => {
    expect(rowsFor([issue()])).toHaveLength(2);
  });

  it('keeps empty groups when asked to', () => {
    const rows = buildRows(
      groupIssues([issue()], 'state', groupContext, {
        showEmptyGroups: true,
        ordering: 'manual',
      }),
      stateById,
    );
    expect(rows.map((row) => row.kind)).toEqual(['header', 'issue', 'header']);
  });

  it('regroups by assignee', () => {
    const rows = buildRows(
      groupIssues(
        [issue({ id: 'a', assigneeId: 'user_2' }), issue({ id: 'b', identifier: 'ENG-9' })],
        'assignee',
        groupContext,
        { showEmptyGroups: false, ordering: 'manual' },
      ),
      stateById,
    );
    expect(rows.flatMap((row) => (row.kind === 'header' ? [row.group.title] : []))).toEqual([
      'Aditi Rao',
      'No assignee',
    ]);
  });
});
