import { Avatar } from '@/components/ui/avatar.tsx';
import { LineChart } from '@/features/charts/line-chart.tsx';
import { buildBurnUp, burnUpMetric } from './burn-up.ts';
import type { AssigneeTally, CycleView, StateGroup } from './data.ts';

function Tally({
  label,
  issues,
  points,
}: {
  readonly label: string;
  readonly issues: number;
  readonly points: number | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-medium text-lg text-text tabular">
        {issues}
        <span className="ml-1 font-normal text-2xs text-muted">
          {issues === 1 ? 'task' : 'tasks'}
        </span>
      </span>
      {points === null ? null : (
        <span className="text-2xs text-muted tabular">
          {points} {points === 1 ? 'point' : 'points'}
        </span>
      )}
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

function AssigneeTable({
  groups,
  assignees,
}: {
  readonly groups: readonly StateGroup[];
  readonly assignees: readonly AssigneeTally[];
}) {
  const totals = groups.map((_, column) =>
    assignees.reduce((sum, row) => sum + (row.points[column] ?? 0), 0),
  );
  const grand = totals.reduce((sum, value) => sum + value, 0);

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-max border-collapse text-2xs tabular"
        data-testid="assignee-points"
      >
        <thead>
          <tr className="border-border border-b">
            <th className="py-1 pr-2 text-left font-medium text-faint">Assignee</th>
            {groups.map((group) => (
              <th key={group.stateId} className="px-1 py-1 text-right font-medium text-faint">
                <span className="flex items-center justify-end gap-1">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                    aria-hidden="true"
                  />
                  {group.name}
                </span>
              </th>
            ))}
            <th className="py-1 pl-2 text-right font-medium text-text">Total</th>
          </tr>
        </thead>
        <tbody>
          {assignees.map((assignee) => (
            <tr key={assignee.id} className="border-border/60 border-b last:border-b-0">
              <td className="py-1 pr-2">
                <span className="flex items-center gap-1.5 text-muted">
                  <Avatar name={assignee.name} src={assignee.image} size="xs" />
                  <span className="truncate">{assignee.name}</span>
                </span>
              </td>
              {groups.map((group, column) => {
                const points = assignee.points[column] ?? 0;
                return (
                  <td
                    key={group.stateId}
                    data-testid={`assignee-${assignee.id}-${group.stateId}`}
                    className={
                      points === 0
                        ? 'px-1 py-1 text-right text-faint'
                        : 'px-1 py-1 text-right text-muted'
                    }
                  >
                    {points}
                  </td>
                );
              })}
              <td
                data-testid={`assignee-${assignee.id}-total`}
                className="py-1 pl-2 text-right text-text"
              >
                {assignee.totalPoints}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-border border-t">
            <td className="py-1 pr-2 text-faint">All</td>
            {totals.map((points, column) => (
              <td
                key={groups[column]?.stateId ?? column}
                className="px-1 py-1 text-right text-muted"
              >
                {points}
              </td>
            ))}
            <td data-testid="assignee-grand-total" className="py-1 pl-2 text-right text-text">
              {grand}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
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
          <Tally
            label="Scope"
            issues={progress.scope}
            points={progress.estimated === 0 ? null : progress.points.scope}
          />
          <Tally
            label="Started"
            issues={progress.started}
            points={progress.estimated === 0 ? null : progress.points.started}
          />
          <Tally
            label="Completed"
            issues={progress.completed}
            points={progress.estimated === 0 ? null : progress.points.completed}
          />
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
            {progress.uncommitted.issues} {progress.uncommitted.issues === 1 ? 'task' : 'tasks'}{' '}
            uncommitted
            {progress.uncommitted.points === 0
              ? ''
              : `, ${progress.uncommitted.points} points not counted`}
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
        <h3 className="font-medium text-dense text-text">Points per assignee</h3>
        {cycle.assignees.length === 0 ? (
          <p className="text-faint text-xs">Nothing assigned in this sprint.</p>
        ) : (
          <AssigneeTable groups={cycle.groups} assignees={cycle.assignees} />
        )}
      </div>
    </aside>
  );
}
