'use client';

import { Users } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import type { Member } from '@/lib/query/schemas.ts';

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
const idleTile =
  'border-border bg-surface text-muted hover:border-border-strong hover:bg-surface-2';

export function PersonTiles({ members, selectedId, counts, onSelect }: PersonTilesProps) {
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
        const count = counts === null ? null : (counts[member.id] ?? 0);
        return (
          <button
            key={member.id}
            type="button"
            data-testid={`standup-tile-${member.id}`}
            aria-pressed={selected}
            title={member.name}
            onClick={() => onSelect(selected ? null : member.id)}
            className={cn(tile, selected ? selectedTile : idleTile)}
          >
            <Avatar name={member.name} src={member.image} size="xs" />
            <span className="max-w-28 truncate">{member.name}</span>
            {count === null || count > 0 ? (
              <span
                data-numeric
                data-testid={`standup-tile-count-${member.id}`}
                title={count === null ? 'Workload counts are unavailable' : undefined}
                className="text-faint"
              >
                {count ?? UNKNOWN_COUNT}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
