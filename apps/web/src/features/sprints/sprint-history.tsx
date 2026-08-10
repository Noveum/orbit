import Link from 'next/link';
import type { PastSprintView } from './data.ts';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function percent(completed: number, scope: number): number {
  return scope === 0 ? 0 : Math.round((completed / scope) * 100);
}

function Bar({ completed, scope }: { readonly completed: number; readonly scope: number }) {
  const share = percent(completed, scope);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
      <div className="h-full rounded-full bg-success" style={{ width: `${share}%` }} />
    </div>
  );
}

function Outcome({ sprint }: { readonly sprint: PastSprintView }) {
  if (sprint.outcome === null) {
    return <p className="text-2xs text-faint">No recorded outcome for this sprint.</p>;
  }
  const { scope, completed, canceled, rolledOver, points, reconstructed } = sprint.outcome;
  return (
    <div className="flex flex-col gap-1.5">
      <Bar completed={completed} scope={scope} />
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted tabular-nums">
        <span>
          <span className="text-text">{completed}</span> of {scope} done
        </span>
        <span>{percent(completed, scope)}%</span>
        {canceled > 0 ? <span>{canceled} cancelled</span> : null}
        {rolledOver > 0 ? <span>{rolledOver} rolled over</span> : null}
        {points.scope > 0 ? (
          <span>
            {points.completed}/{points.scope} pts
          </span>
        ) : null}
        {reconstructed ? (
          <span
            data-testid="sprint-outcome-reconstructed"
            title="Closed before Orbit recorded outcomes, so this is counted from the issues still in the sprint. Anything rolled over into a later sprint is not included."
            className="text-faint"
          >
            counted from its issues
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SprintHistory({ sprints }: { readonly sprints: readonly PastSprintView[] }) {
  if (sprints.length === 0) {
    return (
      <p className="text-faint text-xs">
        No sprint has finished yet. Completed sprints and what they shipped will appear here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="sprint-history">
      {sprints.map((sprint) => (
        <li key={sprint.id}>
          <Link
            href={`/team/${sprint.teamKey.toLowerCase()}/sprint/${sprint.number}`}
            data-testid={`sprint-history-${sprint.teamKey.toLowerCase()}-${sprint.number}`}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 transition-colors duration-[var(--duration-instant)] hover:bg-surface-2 motion-reduce:transition-none"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-dense text-text">{sprint.name}</span>
              <span className="shrink-0 text-2xs text-faint tabular-nums">
                {day(sprint.startsAt)} to {day(sprint.endsAt)}
              </span>
            </div>
            <Outcome sprint={sprint} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
