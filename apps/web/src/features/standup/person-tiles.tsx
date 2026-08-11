'use client';

import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import { UserMinus, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import type { Member } from '@/lib/query/schemas.ts';

export const UNASSIGNED = UNSET_FILTER_VALUE;

export interface PersonTilesProps {
  readonly members: readonly Member[];
  readonly selectedId: string | null;
  readonly counts: Readonly<Record<string, number>> | null;
  readonly onSelect: (userId: string | null) => void;
}

const tile =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-2xs transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]';

const UNKNOWN_COUNT = '?';

const selectedTile = 'border-accent bg-accent/10 text-text';
const idleTile = cn(cardHover, 'border-border bg-surface text-muted');
const emptyTile = cn(cardHover, 'border-border bg-surface text-faint');

function tileTone(selected: boolean, count: number | null): string {
  if (selected) return selectedTile;
  return count === 0 ? emptyTile : idleTile;
}

export function PersonTiles({ members, selectedId, counts, onSelect }: PersonTilesProps) {
  const countOf = (key: string): number | null => (counts === null ? null : (counts[key] ?? 0));
  const unassigned = countOf(UNASSIGNED);

  return (
    <div
      data-testid="standup-tiles"
      className="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
    >
      <button
        type="button"
        data-testid="standup-tile-everyone"
        aria-pressed={selectedId === null}
        onClick={() => onSelect(null)}
        className={cn(tile, selectedId === null ? selectedTile : idleTile)}
      >
        <Users className="size-3.5" aria-hidden="true" />
        Everyone
      </button>
      {members.map((member) => {
        const selected = member.id === selectedId;
        const count = countOf(member.id);
        return (
          <button
            key={member.id}
            type="button"
            data-testid={`standup-tile-${member.id}`}
            aria-pressed={selected}
            title={member.name}
            onClick={() => onSelect(selected ? null : member.id)}
            className={cn(tile, tileTone(selected, count))}
          >
            <Avatar name={member.name} src={member.image} size="xs" />
            <span className="max-w-28 truncate">{member.name}</span>
            <TileCount tileId={member.id} count={count} />
          </button>
        );
      })}
      {unassigned === null || unassigned > 0 ? (
        <button
          type="button"
          data-testid={`standup-tile-${UNASSIGNED}`}
          aria-pressed={selectedId === UNASSIGNED}
          title="Issues nobody owns"
          onClick={() => onSelect(selectedId === UNASSIGNED ? null : UNASSIGNED)}
          className={cn(tile, tileTone(selectedId === UNASSIGNED, unassigned))}
        >
          <UserMinus className="size-3.5" aria-hidden="true" />
          Unassigned
          <TileCount tileId={UNASSIGNED} count={unassigned} />
        </button>
      ) : null}
    </div>
  );
}

interface TileCountProps {
  readonly tileId: string;
  readonly count: number | null;
}

function TileCount({ tileId, count }: TileCountProps) {
  return (
    <span
      data-numeric
      data-testid={`standup-tile-count-${tileId}`}
      title={count === null ? 'Workload counts are unavailable' : undefined}
      className="text-faint"
    >
      {count ?? UNKNOWN_COUNT}
    </span>
  );
}
