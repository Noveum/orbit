import { RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { cn } from '@/lib/cn.ts';
import { cardHover, rowHover } from '@/lib/interaction.ts';
import { buildBurnUp, burnUpMetric } from './burn-up.ts';
import type { CycleView, UpcomingCycleView } from './data.ts';

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function Tally({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="flex flex-col">
      <span className="font-medium text-lg text-text tabular">{value}</span>
      <span className="text-2xs text-faint uppercase">{label}</span>
    </div>
  );
}

function ScopeChanges({ progress }: { readonly progress: CycleView['progress'] }) {
  const { added, removed } = progress.changes;
  const canceled = progress.canceled;
  if (added === 0 && removed === 0 && canceled === 0) return null;
  return (
    <p
      data-testid="sprint-scope-changes"
      className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted tabular"
    >
      {added > 0 ? <span>{added} added</span> : null}
      {removed > 0 ? <span>{removed} removed</span> : null}
      {canceled > 0 ? <span>{canceled} cancelled</span> : null}
    </p>
  );
}

export function CycleAnalytics({ cycle }: { readonly cycle: CycleView }) {
  const { progress } = cycle;
  const metric = burnUpMetric(progress.estimated);
  const counted = metric === 'points' ? progress.points : progress;
  const burnUp = buildBurnUp({
    metric,
    burnUp: progress.burnUp,
    scope: counted.scope,
    startsAt: new Date(cycle.startsAt),
    endsAt: new Date(cycle.endsAt),
  });
  const unit = metric === 'points' ? 'points' : 'issues';

  return (
    <aside className="flex flex-col gap-5 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tally label="Scope" value={progress.scope} />
          <Tally label="Started" value={progress.started} />
          <Tally label="Completed" value={progress.completed} />
        </div>
        {progress.estimated === 0 ? null : (
          <p data-testid="sprint-points" className="text-center text-2xs text-muted tabular">
            {progress.points.completed} of {progress.points.scope} points completed
          </p>
        )}
        <ScopeChanges progress={progress} />
      </div>

      <LineChart
        title="Burn up"
        description={`${counted.completed} of ${counted.scope} ${unit} completed against the scope of the sprint and the ideal pace.`}
        max={burnUp.max}
        labels={burnUp.labels}
        series={[
          { id: 'ideal', label: 'Ideal', tone: 'faint', dashed: true, values: burnUp.ideal },
          { id: 'scope', label: 'Scope', tone: 'muted', values: burnUp.scope },
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
          <p className="text-faint text-xs">Nothing assigned in this sprint.</p>
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
              <li key={issue.id} className="border-border border-b last:border-b-0">
                <Link
                  href={`/issue/${issue.identifier}`}
                  data-testid={`sprint-issue-${issue.identifier}`}
                  className={cn(
                    'flex items-center gap-3 px-3 py-1.5 outline-none',
                    'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
                    rowHover,
                  )}
                >
                  <span className="w-16 shrink-0 text-2xs text-faint tabular">
                    {issue.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-dense text-text">
                    {issue.title}
                  </span>
                  {issue.assignee === null ? null : (
                    <Avatar name={issue.assignee.name} src={issue.assignee.image} size="xs" />
                  )}
                </Link>
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
          title="No active sprint"
          description={`${teamName} has no sprint running right now.`}
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
        <h3 className="font-medium text-dense text-text">Upcoming sprints</h3>
        {upcoming.length === 0 ? (
          <p className="text-faint text-xs">Nothing scheduled after this one.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {upcoming.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5',
                  cardHover,
                )}
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
