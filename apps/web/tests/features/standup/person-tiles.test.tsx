import { describe, expect, it } from 'bun:test';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PersonTiles } from '../../../src/features/standup/person-tiles.tsx';
import type { Member } from '../../../src/lib/query/schemas.ts';

function member(id: string, name: string): Member {
  return { id, name, email: `${id}@orbit.test`, image: null, handle: null, role: 'member' };
}

const members: readonly Member[] = [
  member('user_ada', 'Ada Lovelace'),
  member('user_bo', 'Bo Chen'),
  member('user_cy', 'Cy Diaz'),
];

const counts: Readonly<Record<string, number>> = { user_ada: 5, user_bo: 2 };

function mount(
  selectedId: string | null,
  onSelect: (id: string | null) => void = () => undefined,
  shown: Readonly<Record<string, number>> | null = counts,
) {
  render(
    <PersonTiles members={members} selectedId={selectedId} counts={shown} onSelect={onSelect} />,
  );
}

describe('PersonTiles', () => {
  it('gives everybody a tile, with Everyone in front', () => {
    mount(null);

    const tiles = within(screen.getByTestId('standup-tiles')).getAllByRole('button');
    expect(tiles.map((tile) => tile.getAttribute('data-testid'))).toEqual([
      'standup-tile-everyone',
      'standup-tile-user_ada',
      'standup-tile-user_bo',
      'standup-tile-user_cy',
    ]);
  });

  it('starts on Everyone when nobody is picked', () => {
    mount(null);

    expect(screen.getByTestId('standup-tile-everyone').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('standup-tile-user_ada').getAttribute('aria-pressed')).toBe('false');
  });

  it('marks the person the board is filtered to', () => {
    mount('user_bo');

    expect(screen.getByTestId('standup-tile-user_bo').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('standup-tile-everyone').getAttribute('aria-pressed')).toBe('false');
  });

  it('hands back the person that was clicked', async () => {
    const user = userEvent.setup();
    let picked: string | null | undefined;
    mount(null, (id) => {
      picked = id;
    });

    await user.click(screen.getByTestId('standup-tile-user_bo'));

    expect(picked).toBe('user_bo');
  });

  it('clears the filter when the selected person is clicked again', async () => {
    const user = userEvent.setup();
    let picked: string | null | undefined;
    mount('user_bo', (id) => {
      picked = id;
    });

    await user.click(screen.getByTestId('standup-tile-user_bo'));

    expect(picked).toBeNull();
  });

  it('clears the filter from the Everyone tile', async () => {
    const user = userEvent.setup();
    let picked: string | null | undefined;
    mount('user_bo', (id) => {
      picked = id;
    });

    await user.click(screen.getByTestId('standup-tile-everyone'));

    expect(picked).toBeNull();
  });

  it('shows how much each person is carrying', () => {
    mount(null);

    expect(screen.getByTestId('standup-tile-count-user_ada').textContent).toBe('5');
    expect(screen.getByTestId('standup-tile-count-user_bo').textContent).toBe('2');
  });

  it('leaves the count off somebody carrying nothing rather than showing a zero', () => {
    mount(null);

    expect(screen.queryByTestId('standup-tile-count-user_cy')).toBeNull();
  });

  it('says the counts are unknown rather than passing a failed lookup off as nobody working', () => {
    mount(null, () => undefined, null);

    for (const id of ['user_ada', 'user_bo', 'user_cy']) {
      const badge = screen.getByTestId(`standup-tile-count-${id}`);
      expect(badge.textContent).toBe('?');
      expect(badge.getAttribute('title')).toBe('Workload counts are unavailable');
    }
  });
});
