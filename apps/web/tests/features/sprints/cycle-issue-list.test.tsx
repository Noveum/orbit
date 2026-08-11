import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CycleIssueList } from '../../../src/features/sprints/cycle-board.tsx';
import { breakDownCycleIssues, type CycleView } from '../../../src/features/sprints/data.ts';

const cycle = {
  id: 'cycle_1',
  name: 'Sprint 4',
  teamKey: 'ENG',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2026-01-14T00:00:00.000Z',
  scope: 2,
  started: 1,
  completed: 0,
  burnUp: [],
  assignees: [],
  groups: [
    {
      stateId: 'state_todo',
      name: 'Todo',
      color: '#8b8b8b',
      issues: [
        {
          id: 'issue_1',
          identifier: 'ENG-42',
          title: 'Ship the planner',
          assignee: null,
        },
        {
          id: 'issue_2',
          identifier: 'ENG-43',
          title: 'Wire the tiles',
          assignee: { id: 'member_1', name: 'Ada Lovelace', image: null },
        },
      ],
    },
  ],
} as unknown as CycleView;

afterEach(cleanup);

describe('CycleIssueList', () => {
  it('makes every sprint issue open its issue page', () => {
    render(<CycleIssueList cycle={cycle} />);

    const first = screen.getByTestId('sprint-issue-ENG-42');
    expect(first.tagName).toBe('A');
    expect(first.getAttribute('href')).toBe('/issue/ENG-42');

    const second = screen.getByTestId('sprint-issue-ENG-43');
    expect(second.getAttribute('href')).toBe('/issue/ENG-43');
  });

  it('still shows the identifier, the title and the assignee', () => {
    render(<CycleIssueList cycle={cycle} />);

    const row = screen.getByTestId('sprint-issue-ENG-43');
    expect(row.textContent).toContain('ENG-43');
    expect(row.textContent).toContain('Wire the tiles');
    expect(within(row).getByRole('img', { name: 'Ada Lovelace' })).toBeDefined();
  });

  it('shows no avatar on an unassigned issue', () => {
    render(<CycleIssueList cycle={cycle} />);

    const row = screen.getByTestId('sprint-issue-ENG-42');
    expect(within(row).queryByRole('img')).toBeNull();
  });

  it('gives the row a visible focus ring so it is reachable by keyboard', () => {
    render(<CycleIssueList cycle={cycle} />);

    const row = screen.getByTestId('sprint-issue-ENG-42');
    expect(row.className).toContain('focus-visible:ring');
  });
});

describe('states that share a name across teams', () => {
  it('shows one group, not one per team', () => {
    const { groups } = breakDownCycleIssues([
      {
        id: 'a',
        identifier: 'NOV-1',
        title: 'From Noveum',
        priority: 0,
        stateId: 'state_nov_backlog',
        stateName: 'Backlog',
        stateCategory: 'backlog',
        stateColor: '#9CA3AF',
        estimate: null,
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
      },
      {
        id: 'b',
        identifier: 'AM-1',
        title: 'From API market',
        priority: 0,
        stateId: 'state_am_backlog',
        stateName: 'Backlog',
        stateCategory: 'backlog',
        stateColor: '#9CA3AF',
        estimate: null,
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.issues.map((issue) => issue.identifier)).toEqual(['NOV-1', 'AM-1']);
  });
});
