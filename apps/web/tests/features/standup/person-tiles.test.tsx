import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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

let picks: (string | null)[] = [];

function mount(
  selectedId: string | null,
  onSelect: (id: string | null) => void = (id) => picks.push(id),
  shown: Readonly<Record<string, number>> | null = counts,
) {
  render(
    <PersonTiles members={members} selectedId={selectedId} counts={shown} onSelect={onSelect} />,
  );
}

describe('PersonTiles', () => {
  beforeEach(() => {
    picks = [];
  });

  afterEach(() => {
    expect(picks).toEqual([]);
  });

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

  it('shows first names while keeping full names accessible and available on hover', () => {
    mount(null);
    const ada = screen.getByRole('button', { name: 'Ada Lovelace' });
    expect(within(ada).getByText('Ada', { exact: true })).toBeVisible();
    expect(within(ada).queryByText('Ada Lovelace', { exact: true })).toBeNull();
    expect(ada).toHaveAttribute('title', 'Ada Lovelace');
    expect(within(screen.getByTestId('standup-tile-user_bo')).getByText('Bo')).toBeVisible();
    expect(within(screen.getByTestId('standup-tile-user_cy')).getByText('Cy')).toBeVisible();
  });

  it('keeps duplicate first names distinct and marks the current user', () => {
    render(
      <PersonTiles
        members={[...members, member('user_other_ada', 'Ada Byron'), member('user_lin', 'Lin')]}
        currentUserId="user_ada"
        selectedId={null}
        counts={counts}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ada Lovelace (You)' })).toBeVisible();
    expect(screen.getByText('Ada (You)', { exact: true })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Ada Byron' })).toBeVisible();
    expect(screen.getByText('Lin', { exact: true })).toBeVisible();
  });

  it('shows full names in the dropdown to distinguish duplicate first names', () => {
    render(
      <PersonTiles
        layout="dropdown"
        members={[member('user_ada', 'Ada Lovelace'), member('user_other_ada', 'Ada Byron')]}
        selectedId={null}
        counts={counts}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByText('Ada Lovelace', { exact: true })).toBeVisible();
    expect(screen.getByText('Ada Byron', { exact: true })).toBeVisible();
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

  it('says zero for somebody carrying nothing under the filters in force', () => {
    mount(null);

    expect(screen.getByTestId('standup-tile-count-user_cy').textContent).toBe('0');
  });

  it('offers the unowned work as a tile of its own when there is any', () => {
    mount(null, () => undefined, { ...counts, none: 3 });

    expect(screen.getByTestId('standup-tile-count-none').textContent).toBe('3');
  });

  it('leaves the unassigned tile out when every issue has an owner', () => {
    mount(null);

    expect(screen.queryByTestId('standup-tile-none')).toBeNull();
  });

  it('hands back the unassigned key when the unowned tile is clicked', async () => {
    const user = userEvent.setup();
    let picked: string | null | undefined;
    mount(
      null,
      (id) => {
        picked = id;
      },
      { ...counts, none: 3 },
    );

    await user.click(screen.getByTestId('standup-tile-none'));

    expect(picked).toBe('none');
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
