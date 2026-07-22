'use client';

import { Avatar } from '@/components/ui/avatar.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
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
  onOpen,
  onToggleSelected,
  onFocus,
}: IssueRowProps) {
  return (
    <div
      data-testid={`issue-row-${issue.identifier}`}
      data-active={active ? 'true' : undefined}
      className={cn(
        'flex h-7 w-full items-center gap-2 px-3 text-dense',
        'transition-colors duration-[var(--duration-fast)]',
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
            'opacity-0 transition-opacity focus-visible:opacity-100',
            (active || selected) && 'opacity-100',
          )}
        />
      </span>
      <PriorityGlyph priority={issue.priority} />
      <span data-numeric className="w-16 shrink-0 text-2xs text-faint">
        {issue.identifier}
      </span>
      {state === undefined ? null : (
        <StateGlyph category={state.category} color={state.color} title={state.name} />
      )}
      <button
        type="button"
        onClick={onOpen}
        onFocus={onFocus}
        className="min-w-0 flex-1 truncate text-left text-text"
      >
        {issue.title}
      </button>
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
      {issue.estimate === null ? null : (
        <span data-numeric className="w-5 text-right text-2xs text-faint">
          {issue.estimate}
        </span>
      )}
      {assignee === undefined ? (
        <span className="size-4.5 rounded-full border border-border border-dashed" />
      ) : (
        <Avatar name={assignee.name} src={assignee.image} size="xs" />
      )}
    </div>
  );
}
