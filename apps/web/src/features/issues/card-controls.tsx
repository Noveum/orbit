'use client';

import { PRIORITIES, PRIORITY_LABELS } from '@orbit/shared/constants';
import { useMemo } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue, Member, WorkflowState } from '@/lib/query/schemas.ts';
import { useUpdateIssue } from '@/lib/query/use-issues.ts';
import { PriorityGlyph } from './priority-glyph.tsx';
import { PropertyMenu, type PropertyOption } from './property-menu.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

function priorityLabel(priority: number): string {
  const labels: Record<number, string> = PRIORITY_LABELS;
  return labels[priority] ?? 'No priority';
}

const TRIGGER =
  'relative z-10 -m-0.5 flex items-center rounded-sm p-0.5 transition-colors duration-[var(--duration-instant)] hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none';

export function StatusControl({
  issue,
  state,
  disabled = false,
}: {
  readonly issue: Issue;
  readonly state: WorkflowState | undefined;
  readonly disabled?: boolean;
}) {
  const workspace = useWorkspace();
  const update = useUpdateIssue(issue.teamId);

  const options = useMemo<PropertyOption[]>(
    () =>
      statesForTeam(workspace.states, issue.teamId).map((entry) => ({
        id: entry.id,
        label: entry.name,
        icon: <StateGlyph category={entry.category} color={entry.color} />,
      })),
    [workspace.states, issue.teamId],
  );

  const glyph =
    state === undefined ? null : (
      <StateGlyph category={state.category} color={state.color} title={state.name} />
    );

  if (disabled || state === undefined) return glyph;

  return (
    <PropertyMenu
      title="Change status"
      options={options}
      selected={[issue.stateId]}
      testId="card-status-menu"
      onSelect={(stateId) => {
        if (stateId !== issue.stateId) update.mutate({ issue, patch: { stateId } });
      }}
    >
      <button
        type="button"
        aria-label={`Status: ${state.name}`}
        data-testid={`card-status-${issue.identifier}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(TRIGGER)}
      >
        {glyph}
      </button>
    </PropertyMenu>
  );
}

export function PriorityControl({
  issue,
  disabled = false,
}: {
  readonly issue: Issue;
  readonly disabled?: boolean;
}) {
  const update = useUpdateIssue(issue.teamId);

  const options = useMemo<PropertyOption[]>(
    () =>
      PRIORITIES.map((priority) => ({
        id: String(priority),
        label: priorityLabel(priority),
        icon: <PriorityGlyph priority={priority} />,
      })),
    [],
  );

  if (disabled) return <PriorityGlyph priority={issue.priority} />;

  return (
    <PropertyMenu
      title="Set priority"
      options={options}
      selected={[String(issue.priority)]}
      testId="card-priority-menu"
      onSelect={(value) => {
        const priority = Number(value);
        if (Number.isInteger(priority) && priority !== issue.priority) {
          update.mutate({ issue, patch: { priority } });
        }
      }}
    >
      <button
        type="button"
        aria-label={`Priority: ${priorityLabel(issue.priority)}`}
        data-testid={`card-priority-${issue.identifier}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(TRIGGER)}
      >
        <PriorityGlyph priority={issue.priority} />
      </button>
    </PropertyMenu>
  );
}

export function AssigneeControl({
  issue,
  assignee,
}: {
  readonly issue: Issue;
  readonly assignee: Member | undefined;
}) {
  const workspace = useWorkspace();
  const update = useUpdateIssue(issue.teamId);

  const options = useMemo<PropertyOption[]>(
    () => [
      { id: '', label: 'No assignee' },
      ...workspace.members.map((member) => ({ id: member.id, label: member.name })),
    ],
    [workspace.members],
  );

  return (
    <PropertyMenu
      title="Assign to"
      align="end"
      options={options}
      selected={[issue.assigneeId ?? '']}
      testId="card-assignee-menu"
      onSelect={(value) => {
        const assigneeId = value === '' ? null : value;
        if (assigneeId !== issue.assigneeId) update.mutate({ issue, patch: { assigneeId } });
      }}
    >
      <button
        type="button"
        aria-label="Change assignee"
        data-testid={`card-assignee-${issue.identifier}`}
        onClick={(event) => event.stopPropagation()}
        className={cn(TRIGGER, 'ml-auto')}
      >
        <AssigneeAvatar assignee={assignee} />
      </button>
    </PropertyMenu>
  );
}

function AssigneeAvatar({ assignee }: { readonly assignee: Member | undefined }) {
  if (assignee === undefined) {
    return <span className="block size-5.5 rounded-full border border-border border-dashed" />;
  }
  return <Avatar name={assignee.name} src={assignee.image} size="sm" />;
}
