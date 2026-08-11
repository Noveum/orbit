import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { CycleBoard } from '../../../src/features/sprints/cycle-board.tsx';
import type { CycleView } from '../../../src/features/sprints/data.ts';

function cycleWith(groups: unknown): CycleView {
  return { id: 'cycle_1', name: 'Sprint 4', groups, assignees: [] } as unknown as CycleView;
}

const cycle = cycleWith([
  {
    stateId: 'state_todo',
    name: 'Todo',
    color: '#8b8b8b',
    issues: [
      { id: 'issue_1', identifier: 'ENG-42', title: 'Ship the planner', assignee: null },
      {
        id: 'issue_2',
        identifier: 'ENG-43',
        title: 'Wire the tiles',
        assignee: { id: 'member_1', name: 'Ada Lovelace', image: null },
      },
    ],
  },
  {
    stateId: 'state_done',
    name: 'Done',
    color: '#5b8def',
    issues: [{ id: 'issue_3', identifier: 'ENG-44', title: 'Land the merge', assignee: null }],
  },
]);

afterEach(cleanup);

describe('the sprint board', () => {
  it('lays the states out as columns rather than one stacked list', () => {
    render(<CycleBoard cycle={cycle} />);

    const todo = screen.getByTestId('sprint-column-state_todo');
    const done = screen.getByTestId('sprint-column-state_done');

    expect(within(todo).getByTestId('sprint-card-ENG-42')).toBeDefined();
    expect(within(todo).getByTestId('sprint-card-ENG-43')).toBeDefined();
    expect(within(done).getByTestId('sprint-card-ENG-44')).toBeDefined();
    expect(within(todo).queryByTestId('sprint-card-ENG-44')).toBeNull();
  });

  it('counts what each column holds in its own header', () => {
    render(<CycleBoard cycle={cycle} />);

    const todo = screen.getByTestId('sprint-column-state_todo');
    const done = screen.getByTestId('sprint-column-state_done');

    expect(within(todo).getByRole('banner').textContent).toBe('Todo2');
    expect(within(done).getByRole('banner').textContent).toBe('Done1');
  });

  it('stands the columns side by side rather than stacking them', () => {
    render(<CycleBoard cycle={cycle} />);

    const todo = screen.getByTestId('sprint-column-state_todo');
    const row = todo.parentElement;

    expect(row?.className).toContain('flex');
    expect(row?.className).not.toContain('flex-col');
    expect(todo.className).toContain('shrink-0');
    expect(todo.className).toMatch(/\bw-\d/);
  });

  it('opens the issue page from a card, with a focus ring for the keyboard', () => {
    render(<CycleBoard cycle={cycle} />);

    const card = screen.getByTestId('sprint-card-ENG-42');
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe('/issue/ENG-42');
    expect(card.className).toContain('focus-visible:ring');
  });

  it('carries the assignee onto the card and leaves it off an unassigned one', () => {
    render(<CycleBoard cycle={cycle} />);

    const assigned = screen.getByTestId('sprint-card-ENG-43');
    expect(within(assigned).getByRole('img', { name: 'Ada Lovelace' })).toBeDefined();
    expect(within(screen.getByTestId('sprint-card-ENG-42')).queryByRole('img')).toBeNull();
  });

  it('lets a wide board scroll on its own instead of pushing the page sideways', () => {
    render(<CycleBoard cycle={cycle} />);

    expect(screen.getByTestId('sprint-board').className).toContain('overflow-x-auto');
  });

  it('says so plainly when the sprint holds nothing', () => {
    render(<CycleBoard cycle={cycleWith([])} />);

    expect(screen.queryByTestId('sprint-board')).toBeNull();
    expect(screen.getByText('Nothing in this sprint yet.')).toBeDefined();
  });
});
