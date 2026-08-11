import { describe, expect, it } from 'bun:test';
import { breakDownCycleIssues, type CycleIssueRow } from '../../../src/features/sprints/data.ts';

function row(overrides: Partial<CycleIssueRow> & { id: string }): CycleIssueRow {
  return {
    identifier: `ENG-${overrides.id}`,
    title: `Issue ${overrides.id}`,
    priority: 0,
    stateId: 'state_todo',
    stateName: 'Todo',
    stateCategory: 'unstarted',
    stateColor: 'var(--color-muted)',
    estimate: 1,
    assigneeId: 'member_1',
    assigneeName: 'Ada Lovelace',
    assigneeImage: null,
    ...overrides,
  };
}

const DONE = { stateId: 'state_done', stateName: 'Done', stateCategory: 'completed' } as const;

describe('breakDownCycleIssues', () => {
  it('groups issues by their state and keeps every one of them', () => {
    const breakdown = breakDownCycleIssues([row({ id: '1' }), row({ id: '2', ...DONE })]);

    expect(breakdown.groups.map((group) => group.name)).toEqual(['Todo', 'Done']);
    expect(breakdown.groups.flatMap((group) => group.issues)).toHaveLength(2);
  });

  it('folds states that share a name across teams into one column', () => {
    const breakdown = breakDownCycleIssues([
      row({
        id: '1',
        stateId: 'state_nov_backlog',
        stateName: 'Backlog',
        stateCategory: 'backlog',
      }),
      row({ id: '2', stateId: 'state_am_backlog', stateName: 'Backlog', stateCategory: 'backlog' }),
    ]);

    expect(breakdown.groups).toHaveLength(1);
    expect(breakdown.groups[0]?.issues).toHaveLength(2);
  });

  it('reports the points each person carries in each column', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', estimate: 3 }),
      row({ id: '2', estimate: 5, ...DONE }),
      row({ id: '3', estimate: 8 }),
    ]);

    expect(breakdown.assignees).toEqual([
      {
        id: 'member_1',
        name: 'Ada Lovelace',
        image: null,
        points: [11, 5],
        issues: [2, 1],
        totalPoints: 16,
        totalIssues: 3,
      },
    ]);
  });

  it('lines every person up against the same columns, filling the gaps with zero', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', estimate: 3 }),
      row({
        id: '2',
        estimate: 5,
        ...DONE,
        assigneeId: 'member_2',
        assigneeName: 'Grace Hopper',
      }),
    ]);

    const columns = breakdown.groups.length;
    for (const assignee of breakdown.assignees) {
      expect(assignee.points).toHaveLength(columns);
      expect(assignee.issues).toHaveLength(columns);
    }
    expect(breakdown.assignees.find((entry) => entry.name === 'Ada Lovelace')?.points).toEqual([
      3, 0,
    ]);
    expect(breakdown.assignees.find((entry) => entry.name === 'Grace Hopper')?.points).toEqual([
      0, 5,
    ]);
  });

  it('counts an issue with no estimate without inventing points for it', () => {
    const breakdown = breakDownCycleIssues([row({ id: '1', estimate: null })]);

    expect(breakdown.assignees[0]?.totalPoints).toBe(0);
    expect(breakdown.assignees[0]?.totalIssues).toBe(1);
  });

  it('keeps cancelled work in its own column rather than dropping it', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', estimate: 3 }),
      row({
        id: '2',
        estimate: 21,
        stateId: 'state_canceled',
        stateName: 'Canceled',
        stateCategory: 'canceled',
      }),
    ]);

    expect(breakdown.groups.map((group) => group.name)).toEqual(['Todo', 'Canceled']);
    expect(breakdown.assignees[0]?.points).toEqual([3, 21]);
  });

  it('sorts the people carrying the most points first and skips unassigned work', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', assigneeId: null, assigneeName: null, estimate: 100 }),
      row({ id: '2', estimate: 2 }),
      row({ id: '3', assigneeId: 'member_2', assigneeName: 'Grace Hopper', estimate: 8 }),
    ]);

    expect(breakdown.assignees.map((entry) => entry.name)).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
    ]);
    expect(breakdown.assignees).toHaveLength(2);
  });
});

describe('the column order of a sprint breakdown', () => {
  it('runs backlog and todo ahead of the started columns whatever order the rows arrive in', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', ...DONE, estimate: 8 }),
      row({
        id: '2',
        stateId: 'state_wip',
        stateName: 'In Progress',
        stateCategory: 'started',
        estimate: 4,
      }),
      row({
        id: '3',
        stateId: 'state_backlog',
        stateName: 'Backlog',
        stateCategory: 'backlog',
        estimate: 2,
      }),
      row({ id: '4', estimate: 1 }),
    ]);

    expect(breakdown.groups.map((group) => group.name)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'Done',
    ]);
  });

  it('keeps every assignee row aligned to that same order', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', ...DONE, estimate: 8 }),
      row({
        id: '2',
        stateId: 'state_backlog',
        stateName: 'Backlog',
        stateCategory: 'backlog',
        estimate: 2,
      }),
      row({ id: '3', estimate: 1 }),
    ]);

    const columns = breakdown.groups.map((group) => group.name);
    const tally = breakdown.assignees[0];

    expect(columns).toEqual(['Backlog', 'Todo', 'Done']);
    expect(tally?.points).toEqual([2, 1, 8]);
    expect(tally?.totalPoints).toBe(11);
  });
});
