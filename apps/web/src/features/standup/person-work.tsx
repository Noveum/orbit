'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { Avatar } from '@/components/ui/avatar.tsx';
import { IssueRow } from '@/features/issues/issue-row.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import type { Issue, Member, StandupWorkload } from '@/lib/query/schemas.ts';
import type { PersonBuckets } from './buckets.ts';

const COLUMN_PROPERTIES: readonly DisplayProperty[] = [
  'priority',
  'identifier',
  'status',
  'labels',
  'project',
];

export interface PersonWorkProps {
  readonly member: Member | undefined;
  readonly buckets: PersonBuckets;
  readonly workload: StandupWorkload | undefined;
  readonly sinceLabel: string;
  readonly peekId: string | null;
  readonly onPeek: (issueId: string) => void;
}

export function PersonWork({
  member,
  buckets,
  workload,
  sinceLabel,
  peekId,
  onPeek,
}: PersonWorkProps) {
  const inProgress = workload?.inProgress ?? buckets.inFlight.length;
  const open = workload?.open ?? buckets.inFlight.length + buckets.upNext.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4" data-testid="standup-panel">
      <div className="flex items-center gap-3">
        <Avatar name={member?.name ?? 'Unknown'} src={member?.image ?? null} size="md" />
        <div className="min-w-0">
          <h2 className="font-medium text-lg text-text" data-testid="standup-person">
            {member?.name ?? 'Unknown member'}
          </h2>
          <p data-numeric className="text-2xs text-faint" data-testid="standup-person-summary">
            {inProgress} in progress, {open} open
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        <IssueColumn
          testId="standup-column-closed"
          title={`Closed ${sinceLabel}`}
          issues={buckets.closed}
          total={workload?.completedSince ?? buckets.closed.length}
          empty="Nothing closed yet."
          peekId={peekId}
          onPeek={onPeek}
        />
        <IssueColumn
          testId="standup-column-in-flight"
          title="In progress"
          issues={buckets.inFlight}
          total={inProgress}
          empty="Nothing in progress."
          peekId={peekId}
          onPeek={onPeek}
        />
        <IssueColumn
          testId="standup-column-up-next"
          title="Up next"
          issues={buckets.upNext}
          total={Math.max(0, open - inProgress)}
          empty="Nothing queued."
          peekId={peekId}
          onPeek={onPeek}
        />
      </div>
    </div>
  );
}

interface IssueColumnProps {
  readonly testId: string;
  readonly title: string;
  readonly issues: readonly Issue[];
  readonly total: number;
  readonly empty: string;
  readonly peekId: string | null;
  readonly onPeek: (issueId: string) => void;
}

function IssueColumn({ testId, title, issues, total, empty, peekId, onPeek }: IssueColumnProps) {
  const workspace = useWorkspace();
  const counted = Math.max(total, issues.length);

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-1.5" data-testid={testId}>
      <div className="flex items-baseline gap-1.5 px-3">
        <h3 className="font-medium text-2xs text-faint uppercase tracking-[0.08em]">{title}</h3>
        {issues.length < counted ? (
          <span data-numeric className="text-2xs text-faint" data-testid={`${testId}-capped`}>
            showing {issues.length} of {counted}
          </span>
        ) : (
          <span data-numeric className="text-2xs text-faint">
            {counted}
          </span>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {issues.map((issue) => (
          <li key={issue.id}>
            <IssueRow
              issue={issue}
              state={workspace.stateById.get(issue.stateId)}
              properties={COLUMN_PROPERTIES}
              labels={issue.labelIds.flatMap((id) => {
                const label = workspace.labelById.get(id);
                return label === undefined ? [] : [label];
              })}
              assignee={
                issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId)
              }
              creator={workspace.memberById.get(issue.creatorId)}
              active={peekId === issue.id}
              selected={false}
              onOpen={() => onPeek(issue.id)}
              onFocus={() => undefined}
              onToggleSelected={() => undefined}
            />
          </li>
        ))}
        {issues.length === 0 ? <li className="px-3 py-1 text-2xs text-faint">{empty}</li> : null}
      </ul>
    </section>
  );
}
