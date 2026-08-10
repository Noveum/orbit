import type { SprintRollUpRow } from '@orbit/core';
import { sprintLabel } from '@orbit/shared/utils';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { NewSprintButton } from './sprint-actions.tsx';

const DAY = 86_400_000;

export interface SprintRollUpTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface SprintRollUpEntry {
  readonly team: SprintRollUpTeam;
  readonly sprint: SprintRollUpRow | null;
}

export function sprintDay(startsAt: Date, endsAt: Date, now: Date): { day: number; total: number } {
  const total = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / DAY));
  const elapsed = Math.floor((now.getTime() - startsAt.getTime()) / DAY) + 1;
  return { day: Math.min(Math.max(elapsed, 1), total), total };
}

export function atRisk(entry: SprintRollUpEntry, now: Date): boolean {
  const sprint = entry.sprint;
  if (sprint === null || sprint.committedPoints === 0) return false;
  const { day, total } = sprintDay(sprint.startsAt, sprint.endsAt, now);
  if (day * 2 <= total) return false;
  return sprint.completedPoints * 3 < sprint.committedPoints;
}

function formatDay(value: Date): string {
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function EmptyRow({
  team,
  canManage,
}: {
  readonly team: SprintRollUpTeam;
  readonly canManage: boolean;
}) {
  return (
    <li
      data-testid={`roll-up-empty-${team.id}`}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5"
    >
      <Badge tone="outline">{team.key}</Badge>
      <span className="text-dense text-text">{team.name}</span>
      <span className="text-2xs text-faint">No sprint running</span>
      {canManage ? (
        <span className="ml-auto">
          <NewSprintButton teamId={team.id} />
        </span>
      ) : null}
    </li>
  );
}

function SprintRow({
  team,
  sprint,
  risk,
  now,
}: {
  readonly team: SprintRollUpTeam;
  readonly sprint: SprintRollUpRow;
  readonly risk: boolean;
  readonly now: Date;
}) {
  const { day, total } = sprintDay(sprint.startsAt, sprint.endsAt, now);

  return (
    <li>
      <Link
        href={`/team/${team.key.toLowerCase()}/sprint/${sprint.number}`}
        data-testid={`roll-up-row-${team.id}`}
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg border border-border px-3 py-2.5 outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
          rowHover,
        )}
      >
        <Badge tone="accent">{team.key}</Badge>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-dense text-text">{sprintLabel(sprint)}</span>
          <span className="shrink-0 text-2xs text-faint tabular">
            {formatDay(sprint.startsAt)} to {formatDay(sprint.endsAt)}
          </span>
          <span className="shrink-0 text-2xs text-faint tabular">
            Day {day} of {total}
          </span>
          {risk ? (
            <AlertTriangle
              className="size-3.5 shrink-0 text-danger"
              aria-label="Behind pace"
              data-testid={`roll-up-risk-${team.id}`}
            />
          ) : null}
        </span>
        <span
          data-testid={`roll-up-points-${team.id}`}
          className="shrink-0 text-2xs text-muted tabular"
        >
          {sprint.completedPoints} / {sprint.committedPoints} pts
        </span>
        <span className="col-span-3">
          <ProgressBar
            completed={sprint.completedPoints}
            scope={sprint.committedPoints}
            label={`${team.name} sprint progress`}
          />
        </span>
      </Link>
    </li>
  );
}

export function SprintRollUp({
  entries,
  canManage,
  now = new Date(),
}: {
  readonly entries: readonly SprintRollUpEntry[];
  readonly canManage: boolean;
  readonly now?: Date;
}): ReactElement {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCcw strokeWidth={1.75} aria-hidden="true" />}
        title="No teams yet"
        description="Sprints belong to a team. Create one in workspace settings first."
      />
    );
  }

  const ordered = [...entries].sort((left, right) => {
    const risk = Number(atRisk(right, now)) - Number(atRisk(left, now));
    if (risk !== 0) return risk;
    const leftEnd = left.sprint?.endsAt.getTime() ?? Number.POSITIVE_INFINITY;
    const rightEnd = right.sprint?.endsAt.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftEnd !== rightEnd) return leftEnd - rightEnd;
    return left.team.name.localeCompare(right.team.name);
  });

  return (
    <ul className="flex flex-col gap-1.5" data-testid="sprint-roll-up">
      {ordered.map((entry) =>
        entry.sprint === null ? (
          <EmptyRow key={entry.team.id} team={entry.team} canManage={canManage} />
        ) : (
          <SprintRow
            key={entry.team.id}
            team={entry.team}
            sprint={entry.sprint}
            risk={atRisk(entry, now)}
            now={now}
          />
        ),
      )}
    </ul>
  );
}
