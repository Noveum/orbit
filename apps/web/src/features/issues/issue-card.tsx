'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES } from '@orbit/shared/filters';
import Link from 'next/link';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Avatar } from '@/components/ui/avatar.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue, Label, Member } from '@/lib/query/schemas.ts';
import { PriorityGlyph } from './priority-glyph.tsx';

export interface IssueCardProps {
  readonly issue: Issue;
  readonly labels: readonly Label[];
  readonly assignee: Member | undefined;
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
