'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { useMemo } from 'react';
import { IssueCard } from '@/features/issues/issue-card.tsx';
import { StateGlyph } from '@/features/issues/state-glyph.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import type { Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import type { StageGroup } from './buckets.ts';

const CARD_PROPERTIES: readonly DisplayProperty[] = [
  'priority',
  'status',
  'identifier',
  'labels',
  'project',
  'dueDate',
];

interface CardLookups {
  readonly labelById: ReadonlyMap<string, Label>;
  readonly memberById: ReadonlyMap<string, Member>;
  readonly stateById: ReadonlyMap<string, WorkflowState>;
  readonly projectById: ReadonlyMap<string, Project>;
}

export interface StageColumnsProps {
  readonly stages: readonly StageGroup[];
  readonly assignee: Member;
  readonly onOpen: (issueId: string) => void;
}

export function StageColumns({ stages, assignee, onOpen }: StageColumnsProps) {
  const { labelById, memberById, stateById, projects } = useWorkspace();
  const lookups = useMemo<CardLookups>(
    () => ({
      labelById,
      memberById,
      stateById,
      projectById: new Map(projects.map((project) => [project.id, project])),
    }),
    [labelById, memberById, stateById, projects],
  );

  if (stages.length === 0) {
    return (
      <div
        data-testid="standup-stages"
        className="flex min-h-0 flex-1 items-center justify-center p-3 text-dense text-muted"
      >
        Nothing on the board for {assignee.name} in this window.
      </div>
    );
  }

  return (
    <div
      data-testid="standup-stages"
      className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3"
    >
      {stages.map((stage) => (
        <StageColumn
          key={stage.category}
          stage={stage}
          assignee={assignee}
          lookups={lookups}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

interface StageColumnProps {
  readonly stage: StageGroup;
  readonly assignee: Member;
  readonly lookups: CardLookups;
  readonly onOpen: (issueId: string) => void;
}

function StageColumn({ stage, assignee, lookups, onOpen }: StageColumnProps) {
  const first = stage.issues[0];
  const color = first === undefined ? null : (lookups.stateById.get(first.stateId)?.color ?? null);

  return (
    <section
      aria-label={stage.title}
      data-testid={`standup-stage-${stage.category}`}
      className="flex min-w-72 max-w-[26rem] flex-1 shrink-0 flex-col rounded-lg bg-surface-2/60"
    >
      <header className="flex shrink-0 items-center gap-2 px-2.5 py-2">
        {color === null ? null : (
          <StateGlyph category={stage.category} color={color} title={stage.title} />
        )}
        <h2 className="min-w-0 flex-1 truncate font-medium text-dense text-text">{stage.title}</h2>
        <span
          data-numeric
          className="shrink-0 text-2xs text-faint"
          data-testid={`standup-stage-count-${stage.category}`}
        >
          {stage.issues.length}
        </span>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {stage.issues.map((issue) => (
          <li key={issue.id} className="list-none">
            <StandupCard issue={issue} assignee={assignee} lookups={lookups} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface StandupCardProps {
  readonly issue: Issue;
  readonly assignee: Member;
  readonly lookups: CardLookups;
  readonly onOpen: (issueId: string) => void;
}

function StandupCard({ issue, assignee, lookups, onOpen }: StandupCardProps) {
  return (
    <IssueCard
      issue={issue}
      properties={CARD_PROPERTIES}
      labels={issue.labelIds.flatMap((id) => {
        const label = lookups.labelById.get(id);
        return label === undefined ? [] : [label];
      })}
      assignee={assignee}
      state={lookups.stateById.get(issue.stateId)}
      creator={lookups.memberById.get(issue.creatorId)}
      project={issue.projectId === null ? undefined : lookups.projectById.get(issue.projectId)}
      onOpen={onOpen}
    />
  );
}
