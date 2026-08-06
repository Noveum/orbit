import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PersonTiles } from '../../../src/features/standup/person-tiles.tsx';
import type { Member, StandupWorkload } from '../../../src/lib/query/schemas.ts';

function member(id: string, name: string): Member {
  return { id, name, email: `${id}@orbit.test`, image: null, handle: null, role: 'member' };
}

const people: readonly Member[] = [
  member('user_ada', 'Ada Lovelace'),
  member('user_bo', 'Bo Chen'),
  member('user_cy', 'Cy Diaz'),
];

const workloadById = new Map<string, StandupWorkload>([
  ['user_ada', { userId: 'user_ada', open: 6, inProgress: 2, completedSince: 1 }],
]);

const countById = new Map<string, number>([
  ['user_ada', 5],
  ['user_bo', 3],
]);

function renderTiles(activeId: string | null, onSelect = mock()) {
  render(
    <PersonTiles
      people={people}
      activeId={activeId}
      workloadById={workloadById}
      countById={countById}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('PersonTiles', () => {
  it('renders one tile per workspace member', () => {
    renderTiles('user_ada');

    const tiles = within(screen.getByTestId('standup-tiles')).getAllByRole('button');
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'Ada Lovelace2',
      'Bo Chen3',
      'Cy Diaz0',
    ]);
  });

  it('marks the selected person with aria-current and nobody else', () => {
    renderTiles('user_bo');

    expect(screen.getByTestId('standup-tile-user_bo').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('standup-tile-user_ada').getAttribute('aria-current')).toBe('false');
    expect(screen.getByTestId('standup-tile-user_cy').getAttribute('aria-current')).toBe('false');
  });

  it('never points at a panel it does not own', () => {
    renderTiles('user_ada');

    for (const tile of within(screen.getByTestId('standup-tiles')).getAllByRole('button')) {
      expect(tile.getAttribute('aria-controls')).toBeNull();
      expect(tile.getAttribute('role')).toBeNull();
    }
  });

  it('hands the clicked person id back to the board', () => {
    const onSelect = renderTiles('user_ada');

    fireEvent.click(screen.getByTestId('standup-tile-user_cy'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('user_cy');
  });

  it('prefers the exact in progress count over what fits on the board', () => {
    renderTiles('user_ada');

    expect(screen.getByTestId('standup-tile-user_ada').textContent).toContain('2');
    expect(screen.getByTestId('standup-tile-user_bo').textContent).toContain('3');
  });

  it('dims a person with nothing on the board but keeps them walkable', () => {
    renderTiles('user_ada');

    const empty = screen.getByTestId('standup-tile-user_cy');
    expect(empty.className).toContain('opacity-60');
    expect(empty.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the active tile in view without animating layout', () => {
    const scrolled: unknown[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: unknown) {
      scrolled.push(options);
    } as typeof Element.prototype.scrollIntoView;

    try {
      renderTiles('user_bo');
    } finally {
      Element.prototype.scrollIntoView = original;
    }

    expect(scrolled).toEqual([{ block: 'nearest', inline: 'nearest' }]);
  });
});
