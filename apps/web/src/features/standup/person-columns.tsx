'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { useMemo } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { IssueCard } from '@/features/issues/issue-card.tsx';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import type { Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import type { PersonColumn } from './buckets.ts';

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

export interface PersonColumnsProps {
  readonly columns: readonly PersonColumn[];
  readonly onOpen: (issueId: string) => void;
}

export function PersonColumns({ columns, onOpen }: PersonColumnsProps) {
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

  return (
    <div
      data-testid="standup-columns"
      className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-3"
    >
      {columns.map((column) => (
        <PersonColumnView
          key={column.member.id}
          column={column}
          lookups={lookups}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

interface PersonColumnViewProps {
  readonly column: PersonColumn;
  readonly lookups: CardLookups;
  readonly onOpen: (issueId: string) => void;
}

function PersonColumnView({ column, lookups, onOpen }: PersonColumnViewProps) {
  const { member, issues, total } = column;

  return (
    <section
      aria-label={member.name}
      data-testid={`standup-column-${member.id}`}
      className="flex w-72 shrink-0 flex-col rounded-lg bg-surface-2/60"
    >
      <header className="flex shrink-0 items-center gap-2 px-2.5 py-2">
        <Avatar name={member.name} src={member.image} size="sm" />
        <h2 className="min-w-0 flex-1 truncate font-medium text-dense text-text">{member.name}</h2>
        <span
          data-numeric
          className="shrink-0 text-2xs text-faint"
          data-testid={`standup-count-${member.id}`}
        >
          {issues.length < total ? `${issues.length} of ${total}` : issues.length}
        </span>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {issues.map((issue) => (
          <li key={issue.id} className="list-none">
            <StandupCard issue={issue} assignee={member} lookups={lookups} onOpen={onOpen} />
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
