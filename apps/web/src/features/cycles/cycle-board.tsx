import { RefreshCcw } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { buildBurnUp } from './burn-up.ts';
import type { CycleView, UpcomingCycleView } from './data.ts';

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function CycleAnalytics({ cycle }: { readonly cycle: CycleView }) {
  const burnUp = buildBurnUp({
    burnUp: cycle.progress.burnUp,
    scope: cycle.progress.scope,
    startsAt: new Date(cycle.startsAt),
    endsAt: new Date(cycle.endsAt),
  });

  return (
    <aside className="flex flex-col gap-5 rounded-lg border border-border p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="flex flex-col">
          <span className="font-medium text-lg text-text tabular">{cycle.progress.scope}</span>
          <span className="text-2xs text-faint uppercase">Scope</span>
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-lg text-text tabular">{cycle.progress.started}</span>
          <span className="text-2xs text-faint uppercase">Started</span>
        </div>
        <div className="flex flex-col">
          <span className="font-medium text-lg text-text tabular">{cycle.progress.completed}</span>
          <span className="text-2xs text-faint uppercase">Completed</span>
        </div>
      </div>

      <LineChart
        title="Burn up"
        description={`${cycle.progress.completed} of ${cycle.progress.scope} issues completed against the ideal pace.`}
        max={burnUp.max}
        labels={burnUp.labels}
        series={[
          { id: 'ideal', label: 'Ideal', tone: 'faint', dashed: true, values: burnUp.ideal },
          {
            id: 'completed',
            label: 'Completed',
            tone: 'accent',
            filled: true,
            values: burnUp.completed,
          },
        ]}
      />

      <div className="flex flex-col gap-2.5">
        <h3 className="font-medium text-dense text-text">Per assignee</h3>
        {cycle.assignees.length === 0 ? (
          <p className="text-faint text-xs">Nothing assigned in this cycle.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {cycle.assignees.map((assignee) => (
              <li key={assignee.id} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted text-xs">
                    <Avatar name={assignee.name} src={assignee.image} size="xs" />
                    {assignee.name}
                  </span>
                  <span className="text-2xs text-faint tabular">
                    {assignee.completed}/{assignee.scope}
                  </span>
                </span>
                <ProgressBar
                  completed={assignee.completed}
                  scope={assignee.scope}
                  label={`${assignee.name} completion`}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export function CycleIssueList({ cycle }: { readonly cycle: CycleView }) {
  return (
    <div className="flex flex-col gap-5">
      {cycle.groups.map((group) => (
        <section key={group.stateId} className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-2 font-medium text-dense text-text">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: group.color }}
              aria-hidden="true"
            />
            {group.name}
            <span className="text-2xs text-faint tabular">{group.issues.length}</span>
          </h3>
          <ul className="flex flex-col rounded-lg border border-border">
            {group.issues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-center gap-3 border-border border-b px-3 py-1.5 last:border-b-0"
              >
                <span className="w-16 shrink-0 text-2xs text-faint tabular">
                  {issue.identifier}
                </span>
                <span className="min-w-0 flex-1 truncate text-dense text-text">{issue.title}</span>
                {issue.assignee === null ? null : (
                  <Avatar name={issue.assignee.name} src={issue.assignee.image} size="xs" />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export interface CyclePanelProps {
  readonly cycle: CycleView | null;
  readonly upcoming: readonly UpcomingCycleView[];
  readonly teamName: string;
}

export function CyclePanel({ cycle, upcoming, teamName }: CyclePanelProps) {
  return (
    <div className="flex flex-col gap-6">
      {cycle === null ? (
        <EmptyState
          icon={<RefreshCcw strokeWidth={1.75} aria-hidden="true" />}
          title="No active cycle"
          description={`${teamName} has no cycle running right now.`}
        />
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-lg text-text">{cycle.name}</h2>
            <Badge tone="accent">{cycle.teamKey}</Badge>
            <span className="text-faint text-xs tabular">
              {formatDay(cycle.startsAt)} to {formatDay(cycle.endsAt)}
            </span>
          </header>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <CycleIssueList cycle={cycle} />
            <CycleAnalytics cycle={cycle} />
          </div>
        </>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-dense text-text">Upcoming cycles</h3>
        {upcoming.length === 0 ? (
          <p className="text-faint text-xs">Nothing scheduled after this one.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {upcoming.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
              >
                <span className="flex items-center gap-2 text-dense text-text">
                  <Badge tone="outline">{entry.teamKey}</Badge>
                  {entry.name}
                </span>
                <span className="text-2xs text-faint tabular">
                  {formatDay(entry.startsAt)} to {formatDay(entry.endsAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
