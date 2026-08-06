import { describe, expect, it } from 'bun:test';
import { breakDownCycleIssues, type CycleIssueRow } from '../../../src/features/cycles/data.ts';

function row(overrides: Partial<CycleIssueRow> & { id: string }): CycleIssueRow {
  return {
    identifier: `ENG-${overrides.id}`,
    title: `Issue ${overrides.id}`,
    priority: 0,
    stateId: 'state_todo',
    stateName: 'Todo',
    stateCategory: 'unstarted',
    stateColor: 'var(--color-muted)',
    assigneeId: 'member_1',
    assigneeName: 'Ada Lovelace',
    assigneeImage: null,
    ...overrides,
  };
}

describe('breakDownCycleIssues', () => {
  it('groups issues by their state and keeps every one of them', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1' }),
      row({ id: '2', stateId: 'state_done', stateName: 'Done', stateCategory: 'completed' }),
    ]);

    expect(breakdown.groups.map((group) => group.name)).toEqual(['Todo', 'Done']);
    expect(breakdown.groups.flatMap((group) => group.issues)).toHaveLength(2);
  });

  it('counts completed work against the scope each person carries', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1' }),
      row({ id: '2', stateId: 'state_done', stateName: 'Done', stateCategory: 'completed' }),
    ]);

    expect(breakdown.assignees).toEqual([
      { id: 'member_1', name: 'Ada Lovelace', image: null, scope: 2, completed: 1 },
    ]);
  });

  it('leaves cancelled work out of the scope a person carries but keeps it on the board', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1' }),
      row({
        id: '2',
        stateId: 'state_canceled',
        stateName: 'Canceled',
        stateCategory: 'canceled',
      }),
    ]);

    expect(breakdown.assignees[0]?.scope).toBe(1);
    expect(breakdown.groups.flatMap((group) => group.issues)).toHaveLength(2);
  });

  it('sorts the people carrying the most work first and skips unassigned work', () => {
    const breakdown = breakDownCycleIssues([
      row({ id: '1', assigneeId: null, assigneeName: null }),
      row({ id: '2' }),
      row({ id: '3', assigneeId: 'member_2', assigneeName: 'Grace Hopper' }),
      row({ id: '4' }),
    ]);

    expect(breakdown.assignees.map((entry) => entry.name)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect(breakdown.assignees[0]?.scope).toBe(2);
  });
});
