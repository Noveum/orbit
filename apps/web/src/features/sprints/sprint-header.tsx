'use client';

import { sprintLabel } from '@orbit/shared/utils';
import { type KeyboardEvent, type ReactElement, useState } from 'react';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { useUpdateSprint } from '@/lib/query/use-sprints.ts';
import { CompleteSprintButton, EditSprintButton } from './sprint-actions.tsx';

const DAY = 86_400_000;

export function sprintDay(startsAt: Date, endsAt: Date, now: Date): { day: number; total: number } {
  const total = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / DAY));
  const elapsed = Math.floor((now.getTime() - startsAt.getTime()) / DAY) + 1;
  return { day: Math.min(Math.max(elapsed, 1), total), total };
}

export interface HeaderSprint {
  readonly id: string;
  readonly name: string;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly completedAt: string | null;
}

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function SprintHeader({
  sprint,
  canManage,
}: {
  readonly sprint: HeaderSprint;
  readonly canManage: boolean;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sprint.name);
  const update = useUpdateSprint();
  const label = sprintLabel(sprint);
  const running = sprint.completedAt === null;
  const { day, total } = sprintDay(new Date(sprint.startsAt), new Date(sprint.endsAt), new Date());

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === sprint.name.trim()) return;
    update.mutate({ id: sprint.id, name: next });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(sprint.name);
      setEditing(false);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="font-semibold text-lg text-text">
        {editing ? (
          <Input
            autoFocus
            maxLength={120}
            value={draft}
            placeholder={label}
            aria-label="Sprint name"
            data-testid="sprint-name-input"
            className="h-7 w-56"
            onFocus={(event) => event.target.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <button
            type="button"
            disabled={!canManage}
            data-testid="sprint-name"
            onClick={() => setEditing(true)}
            className={cn(
              '-mx-1 rounded-md px-1 font-semibold text-lg text-text outline-none',
              'focus-visible:ring-2 focus-visible:ring-accent',
              canManage ? rowHover : undefined,
            )}
          >
            {label}
          </button>
        )}
      </h1>
      <span className="text-faint text-xs tabular">
        {formatDay(sprint.startsAt)} to {formatDay(sprint.endsAt)}
      </span>
      {running ? (
        <span className="text-faint text-xs tabular" data-testid="sprint-day">
          Day {day} of {total}
        </span>
      ) : null}
      {canManage && running ? (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <EditSprintButton sprint={{ ...sprint, name: label }} />
          <CompleteSprintButton sprint={{ ...sprint, name: label }} />
        </span>
      ) : null}
    </header>
  );
}
