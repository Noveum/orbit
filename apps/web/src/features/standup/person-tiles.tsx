'use client';

import { Check } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import type { RosterEntry } from './buckets.ts';

export interface PersonTilesProps {
  readonly roster: readonly RosterEntry[];
  readonly currentId: string | null;
  readonly spoken: ReadonlySet<string>;
  readonly onSelect: (userId: string) => void;
}

const tileBase =
  'flex w-40 shrink-0 flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]';

const speakingTile = 'border-accent bg-accent/10';
const waitingTile = 'border-border bg-surface hover:border-border-strong hover:bg-surface-2';

function turnLabel(speaking: boolean, done: boolean): string {
  if (speaking) return 'Speaking now';
  if (done) return 'Already spoke';
  return 'Waiting to speak';
}

export function PersonTiles({ roster, currentId, spoken, onSelect }: PersonTilesProps) {
  return (
    <ul
      data-testid="standup-tiles"
      className="flex shrink-0 list-none gap-2 overflow-x-auto border-border border-b px-3 py-3"
    >
      {roster.map((entry, index) => (
        <li key={entry.member.id} className="list-none">
          <PersonTile
            entry={entry}
            position={index + 1}
            speaking={entry.member.id === currentId}
            done={spoken.has(entry.member.id) && entry.member.id !== currentId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

interface PersonTileProps {
  readonly entry: RosterEntry;
  readonly position: number;
  readonly speaking: boolean;
  readonly done: boolean;
  readonly onSelect: (userId: string) => void;
}

function PersonTile({ entry, position, speaking, done, onSelect }: PersonTileProps) {
  const userId = entry.member.id;
  const counted =
    entry.issues.length < entry.total
      ? `${entry.issues.length} of ${entry.total}`
      : `${entry.issues.length}`;

  return (
    <button
      type="button"
      data-testid={`standup-tile-${userId}`}
      data-speaking={speaking ? 'true' : undefined}
      data-spoken={done ? 'true' : undefined}
      aria-pressed={speaking}
      onClick={() => onSelect(userId)}
      className={cn(tileBase, speaking ? speakingTile : waitingTile, done ? 'opacity-55' : null)}
    >
      <span className="flex w-full items-center gap-2">
        <span data-numeric className="w-4 shrink-0 text-2xs text-faint">
          {position}
        </span>
        <Avatar name={entry.member.name} src={entry.member.image} size="sm" />
        {done ? (
          <Check
            className="ml-auto size-3.5 shrink-0 text-state-completed"
            strokeWidth={2.5}
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className="w-full truncate font-medium text-dense text-text">{entry.member.name}</span>
      <span className="flex w-full items-center gap-1.5 text-2xs text-faint">
        <span data-numeric data-testid={`standup-tile-count-${userId}`}>
          {counted}
        </span>
        {entry.inFlight > 0 ? (
          <span data-numeric className="text-state-started">
            {entry.inFlight} active
          </span>
        ) : null}
      </span>
      <span className="sr-only">{turnLabel(speaking, done)}</span>
    </button>
  );
}
