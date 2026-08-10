import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar.tsx';
import { ProgressBar } from '@/features/charts/donut.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { buildBurnUp, burnUpMetric } from './burn-up.ts';
import type { CycleView } from './data.ts';

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
        {progress.uncommitted.issues === 0 ? null : (
          <p
            data-testid="sprint-uncommitted"
            className="text-center text-2xs text-faint tabular"
            title="Issues in triage or backlog states sit in the sprint but count towards nothing until they move to Todo."
          >
            {progress.uncommitted.issues} uncommitted, {progress.uncommitted.points} points not
            counted
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

export interface SprintTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}
