'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES } from '@orbit/shared/filters';
import Link from 'next/link';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue, Label, Member, WorkflowState } from '@/lib/query/schemas.ts';
import { MetaChip, MetaDate } from './issue-meta.tsx';
import { PriorityGlyph } from './priority-glyph.tsx';
import { StateGlyph } from './state-glyph.tsx';

export interface IssueCardProps {
  readonly issue: Issue;
  readonly labels: readonly Label[];
  readonly assignee: Member | undefined;
  readonly state?: WorkflowState | undefined;
  readonly creator?: Member | undefined;
  readonly project?: { readonly name: string; readonly color: string } | undefined;
  readonly cycle?: { readonly name: string } | undefined;
  readonly subIssueCount?: number;
  readonly dragging?: boolean;
  readonly properties?: readonly DisplayProperty[];
  readonly className?: string;
  readonly onOpen?: (issueId: string) => void;
}

function isPlainClick(event: ReactMouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function IssueCard({
  issue,
  labels,
  assignee,
  state,
  creator,
  project,
  cycle,
  subIssueCount = 0,
  dragging = false,
  properties = DEFAULT_DISPLAY_PROPERTIES,
  className,
  onOpen,
}: IssueCardProps) {
  const shows = (property: DisplayProperty) => properties.includes(property);

  const open = (event: ReactMouseEvent<HTMLElement>) => {
    if (onOpen === undefined || event.defaultPrevented || !isPlainClick(event)) return;
    event.preventDefault();
    onOpen(issue.id);
  };

  return (
    <article
      data-testid={`issue-card-${issue.identifier}`}
      className={cn(
        'relative flex select-none flex-col gap-2 rounded-lg border border-border bg-surface p-2.5',
        'transition-[transform,box-shadow,opacity,background-color,border-color] ease-[var(--ease-standard)] motion-reduce:transition-none',
        'duration-[var(--duration-instant)] hover:duration-[var(--duration-base)]',
        'hover:border-border-strong hover:bg-surface-2',
        dragging && '-translate-y-0.5 rotate-[0.4deg] opacity-95 shadow-pop',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-2xs text-faint">
        {shows('priority') ? <PriorityGlyph priority={issue.priority} /> : null}
        {shows('status') && state !== undefined ? (
          <StateGlyph category={state.category} color={state.color} title={state.name} />
        ) : null}
        {shows('identifier') ? (
          <span data-numeric className="truncate whitespace-nowrap font-medium">
            {issue.identifier}
          </span>
        ) : null}
        {shows('estimate') && issue.estimate !== null ? (
          <span
            data-numeric
            className="ml-auto rounded-sm bg-surface-2 px-1 py-px text-2xs text-muted"
          >
            {issue.estimate}
          </span>
        ) : null}
      </div>

      <Link
        href={`/issue/${issue.identifier}`}
        onClick={open}
        draggable={false}
        className="line-clamp-3 text-dense text-text leading-snug after:absolute after:inset-0 hover:text-accent"
      >
        {issue.title}
      </Link>

      <div className="flex flex-wrap items-center gap-1.5">
        {shows('labels') ? <CardLabels labels={labels} /> : null}
        <CardMeta
          issue={issue}
          creator={creator}
          project={project}
          cycle={cycle}
          subIssueCount={subIssueCount}
          properties={properties}
        />
        {shows('assignee') ? <CardAssignee assignee={assignee} /> : null}
      </div>
    </article>
  );
}

function CardLabels({ labels }: { labels: readonly Label[] }) {
  return (
    <>
      {labels.slice(0, 3).map((label) => (
        <span
          key={label.id}
          className="flex items-center gap-1 rounded-sm border border-border px-1 py-px text-2xs text-muted"
        >
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: label.color }}
            aria-hidden="true"
          />
          {label.name}
        </span>
      ))}
    </>
  );
}

function CardAssignee({ assignee }: { assignee: Member | undefined }) {
  return (
    <span className="ml-auto">
      {assignee === undefined ? (
        <span className="block size-5.5 rounded-full border border-border border-dashed" />
      ) : (
        <Avatar name={assignee.name} src={assignee.image} size="sm" />
      )}
    </span>
  );
}

interface CardMetaProps {
  readonly issue: Issue;
  readonly creator: Member | undefined;
  readonly project: { readonly name: string; readonly color: string } | undefined;
  readonly cycle: { readonly name: string } | undefined;
  readonly subIssueCount: number;
  readonly properties: readonly DisplayProperty[];
}

function CardMeta({ issue, creator, project, cycle, subIssueCount, properties }: CardMetaProps) {
  const shows = (property: DisplayProperty) => properties.includes(property);
  return (
    <>
      {shows('subIssues') && subIssueCount > 0 ? (
        <span data-numeric className="shrink-0 text-2xs text-faint" title="Sub-issues">
          {subIssueCount}
        </span>
      ) : null}
      {shows('project') && project !== undefined ? (
        <MetaChip label={project.name} color={project.color} title="Project" />
      ) : null}
      {shows('cycle') && cycle !== undefined ? <MetaChip label={cycle.name} title="Cycle" /> : null}
      {shows('milestone') && issue.milestoneId !== null ? (
        <MetaChip label="Milestone" title="On a milestone" />
      ) : null}
      {shows('dueDate') ? <MetaDate value={issue.dueDate} title="Due date" /> : null}
      {shows('started') ? <MetaDate value={issue.startedAt} title="Started" /> : null}
      {shows('completed') ? <MetaDate value={issue.completedAt} title="Completed" /> : null}
      {shows('created') ? <MetaDate value={issue.createdAt} title="Created" /> : null}
      {shows('updated') ? <MetaDate value={issue.updatedAt} title="Updated" /> : null}
      {shows('creator') && creator !== undefined ? (
        <Avatar name={creator.name} src={creator.image} size="xs" />
      ) : null}
    </>
  );
}
