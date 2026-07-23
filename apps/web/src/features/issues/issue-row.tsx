'use client';

import { Avatar } from '@/components/ui/avatar.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import type { IssueProperty } from '@/features/filters/view-config.ts';
import { ISSUE_PROPERTIES } from '@/features/filters/view-config.ts';
import { cn } from '@/lib/cn.ts';
import type { Issue, Label, Member, WorkflowState } from '@/lib/query/schemas.ts';
import { PriorityGlyph } from './priority-glyph.tsx';
import { StateGlyph } from './state-glyph.tsx';

export const ROW_HEIGHT = 28;

export interface IssueRowProps {
  readonly issue: Issue;
  readonly state: WorkflowState | undefined;
  readonly labels: readonly Label[];
  readonly assignee: Member | undefined;
  readonly active: boolean;
  readonly selected: boolean;
  readonly properties?: readonly IssueProperty[];
  readonly onOpen: () => void;
  readonly onToggleSelected: () => void;
  readonly onFocus: () => void;
}

export function IssueRow({
  issue,
  state,
  labels,
  assignee,
  active,
  selected,
  properties = ISSUE_PROPERTIES,
  onOpen,
  onToggleSelected,
  onFocus,
}: IssueRowProps) {
  const shows = (property: IssueProperty) => properties.includes(property);

  return (
    <div
      data-testid={`issue-row-${issue.identifier}`}
      data-active={active ? 'true' : undefined}
      className={cn(
        'group flex h-7 w-full items-center gap-2 px-3 text-dense',
        'transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)]',
        active ? 'bg-surface-2' : 'hover:bg-surface-2/70',
        selected && 'bg-accent-soft',
      )}
    >
      <span className="flex size-4 items-center justify-center">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          onFocus={onFocus}
          onPointerDown={onFocus}
          aria-label={`Select ${issue.identifier}`}
          className={cn(
            'opacity-0 transition-opacity duration-[var(--duration-instant)] ease-[var(--ease-standard)]',
            'group-hover:opacity-100 group-hover:duration-[var(--duration-fast)]',
            'focus-visible:opacity-100 group-focus-within:opacity-100',
            '[@media(hover:none)]:opacity-100',
            (active || selected) && 'opacity-100',
          )}
        />
      </span>
      {shows('priority') ? <PriorityGlyph priority={issue.priority} /> : null}
      {shows('identifier') ? (
        <span
          data-numeric
          className="w-24 shrink-0 truncate whitespace-nowrap text-2xs text-faint"
          title={issue.identifier}
        >
          {issue.identifier}
        </span>
      ) : null}
      {shows('status') && state !== undefined ? (
        <StateGlyph category={state.category} color={state.color} title={state.name} />
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        onFocus={onFocus}
        className="min-w-0 flex-1 truncate rounded-sm text-left text-text"
      >
        {issue.title}
      </button>
      {shows('labels') ? (
        <span className="hidden items-center gap-1 sm:flex">
          {labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="flex items-center gap-1 rounded-sm border border-border px-1 text-2xs text-muted"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: label.color }}
                aria-hidden="true"
              />
              {label.name}
            </span>
          ))}
        </span>
      ) : null}
      {shows('estimate') && issue.estimate !== null ? (
        <span data-numeric className="w-5 text-right text-2xs text-faint">
          {issue.estimate}
        </span>
      ) : null}
      {shows('assignee') ? <RowAssignee assignee={assignee} /> : null}
    </div>
  );
}

function RowAssignee({ assignee }: { assignee: Member | undefined }) {
  if (assignee === undefined) {
    return <span className="size-4.5 rounded-full border border-border border-dashed" />;
  }
  return <Avatar name={assignee.name} src={assignee.image} size="xs" />;
}
