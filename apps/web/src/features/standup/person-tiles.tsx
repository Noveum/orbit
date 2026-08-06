'use client';

import { useEffect, useRef } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import type { Member, StandupWorkload } from '@/lib/query/schemas.ts';

export interface PersonTilesProps {
  readonly people: readonly Member[];
  readonly activeId: string | null;
  readonly workloadById: ReadonlyMap<string, StandupWorkload>;
  readonly countById: ReadonlyMap<string, number>;
  readonly onSelect: (userId: string) => void;
}

export function PersonTiles({
  people,
  activeId,
  workloadById,
  countById,
  onSelect,
}: PersonTilesProps) {
  const list = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (activeId === null) return;
    list.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  return (
    <ul
      ref={list}
      aria-label="Standup roster"
      data-testid="standup-tiles"
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-border border-b px-3 py-2"
    >
      {people.map((member) => {
        const active = member.id === activeId;
        const onBoard = countById.get(member.id) ?? 0;
        const badge = workloadById.get(member.id)?.inProgress ?? onBoard;
        return (
          <li key={member.id} className="shrink-0">
            <button
              type="button"
              aria-current={active ? 'true' : 'false'}
              data-active={active ? 'true' : undefined}
              data-testid={`standup-tile-${member.id}`}
              onClick={() => onSelect(member.id)}
              className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1.5 text-dense',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
                rowHover,
                active
                  ? 'border-border-strong bg-surface-2 text-text'
                  : 'border-transparent text-muted',
                onBoard === 0 && !active && 'opacity-60',
              )}
            >
              <Avatar name={member.name} src={member.image} size="sm" />
              <span className="max-w-40 truncate">{member.name}</span>
              <span data-numeric className="text-2xs text-faint">
                {badge}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
