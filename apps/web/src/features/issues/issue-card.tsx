'use client';

import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar.tsx';
import type { IssueProperty } from '@/features/filters/view-config.ts';
import { ISSUE_PROPERTIES } from '@/features/filters/view-config.ts';
import { cn } from '@/lib/cn.ts';
import type { Issue, Label, Member } from '@/lib/query/schemas.ts';
import { PriorityGlyph } from './priority-glyph.tsx';

export interface IssueCardProps {
  readonly issue: Issue;
  readonly labels: readonly Label[];
  readonly assignee: Member | undefined;
  readonly dragging?: boolean;
  readonly properties?: readonly IssueProperty[];
  readonly className?: string;
}

export function IssueCard({
  issue,
  labels,
  assignee,
  dragging = false,
  properties = ISSUE_PROPERTIES,
  className,
}: IssueCardProps) {
  const shows = (property: IssueProperty) => properties.includes(property);

  return (
    <article
      data-testid={`issue-card-${issue.identifier}`}
      className={cn(
        'flex select-none flex-col gap-2 rounded-lg border border-border bg-surface p-2.5',
        'transition-[transform,box-shadow,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)]',
        'hover:border-border-strong',
        dragging && '-translate-y-0.5 rotate-[0.4deg] opacity-95 shadow-pop',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-2xs text-faint">
        {shows('priority') ? <PriorityGlyph priority={issue.priority} /> : null}
        {shows('identifier') ? (
          <span data-numeric className="font-medium">
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
        className="line-clamp-3 text-dense text-text leading-snug hover:text-accent"
      >
        {issue.title}
      </Link>

      <div className="flex items-center gap-1.5">
        {shows('labels')
          ? labels.slice(0, 3).map((label) => (
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
            ))
          : null}
        {shows('assignee') ? (
          <span className="ml-auto">
            {assignee === undefined ? (
              <span className="block size-5.5 rounded-full border border-border border-dashed" />
            ) : (
              <Avatar name={assignee.name} src={assignee.image} size="sm" />
            )}
          </span>
        ) : null}
      </div>
    </article>
  );
}
