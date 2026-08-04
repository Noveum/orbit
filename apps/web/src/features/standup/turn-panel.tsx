'use client';

import { AlertTriangle, Check, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { StateGlyph } from '@/features/issues/state-glyph.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import type {
  Issue,
  Member,
  StandupBlocker,
  StandupTurn,
  StandupWorkload,
} from '@/lib/query/schemas.ts';
import { useTeamMemberIssues } from '@/lib/query/use-issues.ts';

export interface TurnPanelProps {
  readonly standupId: string;
  readonly teamId: string;
  readonly turn: StandupTurn;
  readonly member: Member | undefined;
  readonly workload: StandupWorkload | undefined;
  readonly blockers: readonly StandupBlocker[];
  readonly presenting: boolean;
  readonly onSaveNotes: (notes: string) => void;
  readonly onAttendance: (attendance: 'present' | 'absent') => void;
  readonly onAddBlocker: (summary: string, issueId: string | null) => void;
  readonly onResolveBlocker: (blockerId: string, resolved: boolean) => void;
}

const YESTERDAY_WINDOW_MS = 36 * 60 * 60 * 1000;

function isRecent(value: string | null, now: number): boolean {
  if (value === null) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && now - at <= YESTERDAY_WINDOW_MS;
}

export function TurnPanel({
  teamId,
  turn,
  member,
  workload,
  blockers,
  presenting,
  onSaveNotes,
  onAttendance,
  onAddBlocker,
  onResolveBlocker,
}: TurnPanelProps) {
  const workspace = useWorkspace();
  const [notes, setNotes] = useState(turn.notes);
  const [blocker, setBlocker] = useState('');

  const now = Date.now();
  const owned = useTeamMemberIssues(teamId, turn.userId);
  const mine = useMemo(() => owned.data ?? [], [owned.data]);

  const finished = useMemo(
    () => mine.filter((issue) => isRecent(issue.completedAt, now)),
    [mine, now],
  );

  const inFlight = useMemo(
    () =>
      mine.filter((issue) => {
        const category = workspace.stateById.get(issue.stateId)?.category;
        return category === 'started' || category === 'review';
      }),
    [mine, workspace.stateById],
  );

  const upNext = useMemo(
    () =>
      mine.filter((issue) => {
        const category = workspace.stateById.get(issue.stateId)?.category;
        return category === 'unstarted' || category === 'triage';
      }),
    [mine, workspace.stateById],
  );

  const turnBlockers = blockers.filter((entry) => entry.turnId === turn.id);
  const heading = presenting ? 'text-2xl' : 'text-lg';
  const columnTitle = 'font-medium text-2xs text-faint uppercase tracking-[0.08em]';

  return (
    <div className={cn('flex flex-col gap-5', presenting ? 'p-8' : 'p-5')} data-testid="turn-panel">
      <div className="flex items-center gap-3">
        <Avatar
          name={member?.name ?? 'Unknown'}
          src={member?.image ?? null}
          size={presenting ? 'md' : 'sm'}
        />
        <div className="min-w-0 flex-1">
          <h2 className={cn('font-medium text-text', heading)}>
            {member?.name ?? 'Unknown member'}
          </h2>
          {workload === undefined ? null : (
            <p data-numeric className="text-2xs text-faint">
              {workload.inProgress} in progress, {workload.assigned} assigned
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={turn.attendance === 'present' ? 'primary' : 'ghost'}
            data-testid="mark-present"
            onClick={() => onAttendance('present')}
          >
            Present
          </Button>
          <Button
            size="sm"
            variant={turn.attendance === 'absent' ? 'secondary' : 'ghost'}
            data-testid="mark-absent"
            onClick={() => onAttendance('absent')}
          >
            Absent
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <IssueColumn
          title="Since yesterday"
          titleClass={columnTitle}
          issues={finished}
          presenting={presenting}
          empty="Nothing closed yet."
        />
        <IssueColumn
          title="Working on today"
          titleClass={columnTitle}
          issues={inFlight}
          presenting={presenting}
          empty="Nothing in progress."
        />
        <IssueColumn
          title="Up next"
          titleClass={columnTitle}
          issues={upNext.slice(0, 6)}
          presenting={presenting}
          empty="Nothing queued."
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className={columnTitle}>Blockers</h3>
        <ul className="flex flex-col gap-1.5">
          {turnBlockers.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
            >
              <AlertTriangle
                className={cn(
                  'size-3.5',
                  entry.resolvedAt === null ? 'text-warning' : 'text-faint',
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 text-dense',
                  entry.resolvedAt === null ? 'text-text' : 'text-faint line-through',
                )}
              >
                {entry.summary}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={entry.resolvedAt === null ? 'Resolve blocker' : 'Reopen blocker'}
                onClick={() => onResolveBlocker(entry.id, entry.resolvedAt === null)}
              >
                <Check className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {turnBlockers.length === 0 ? (
            <li className="text-2xs text-faint">Nothing blocking.</li>
          ) : null}
        </ul>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const summary = blocker.trim();
            if (summary.length === 0) return;
            onAddBlocker(summary, null);
            setBlocker('');
          }}
        >
          <input
            value={blocker}
            onChange={(event) => setBlocker(event.target.value)}
            placeholder="What is in the way?"
            data-testid="blocker-input"
            className="flex-1 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-dense text-text placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <Button size="sm" variant="secondary" type="submit" data-testid="add-blocker">
            <Plus className="size-3.5" aria-hidden="true" />
            Add
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={columnTitle}>Notes</h3>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== turn.notes) onSaveNotes(notes);
          }}
          rows={presenting ? 3 : 4}
          data-testid="turn-notes"
          placeholder="What the team should remember from this update."
          className="w-full resize-y rounded-md border border-border bg-surface-1 px-2.5 py-2 text-dense text-text placeholder:text-faint focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </section>
    </div>
  );
}

interface IssueColumnProps {
  readonly title: string;
  readonly titleClass: string;
  readonly issues: readonly Issue[];
  readonly presenting: boolean;
  readonly empty: string;
}

function IssueColumn({ title, titleClass, issues, presenting, empty }: IssueColumnProps) {
  const workspace = useWorkspace();
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h3 className={titleClass}>
        {title}
        <span data-numeric className="ml-1.5 text-faint">
          {issues.length}
        </span>
      </h3>
      <ul className="flex flex-col gap-1">
        {issues.map((issue) => {
          const state = workspace.stateById.get(issue.stateId);
          return (
            <li key={issue.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
              {state === undefined ? null : (
                <StateGlyph category={state.category} color={state.color} />
              )}
              <span data-numeric className="shrink-0 text-2xs text-faint">
                {issue.identifier}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-text',
                  presenting ? 'text-dense' : 'text-2xs',
                )}
              >
                {issue.title}
              </span>
            </li>
          );
        })}
        {issues.length === 0 ? <li className="px-1.5 text-2xs text-faint">{empty}</li> : null}
      </ul>
    </section>
  );
}
