'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES } from '@orbit/shared/filters';
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
  readonly creator?: Member | undefined;
  readonly project?: { readonly name: string; readonly color: string } | undefined;
  readonly cycle?: { readonly name: string } | undefined;
  readonly subIssueCount?: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly properties?: readonly DisplayProperty[];
  readonly onOpen: () => void;
  readonly onToggleSelected: () => void;
  readonly onFocus: () => void;
}

function shortDate(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Chip({ label, color, title }: { label: string; color?: string; title: string }) {
  return (
    <span
      title={title}
      className="hidden shrink-0 items-center gap-1 rounded-sm border border-border px-1 text-2xs text-muted md:flex"
    >
      {color === undefined ? null : (
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      )}
      <span className="max-w-24 truncate">{label}</span>
    </span>
  );
}

function DateChip({ value, title }: { value: string | null; title: string }) {
  const label = shortDate(value);
  if (label === null) return null;
  return (
    <span data-numeric title={title} className="shrink-0 text-2xs text-faint">
      {label}
    </span>
  );
}

export function IssueRow({
  issue,
  state,
  labels,
  assignee,
  creator,
  project,
  cycle,
  subIssueCount = 0,
  active,
  selected,
  properties = DEFAULT_DISPLAY_PROPERTIES,
  onOpen,
  onToggleSelected,
  onFocus,
}: IssueRowProps) {
  const shows = (property: DisplayProperty) => properties.includes(property);

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
      <RowMeta
        issue={issue}
        creator={creator}
        project={project}
        cycle={cycle}
        subIssueCount={subIssueCount}
        properties={properties}
      />
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

interface RowMetaProps {
  readonly issue: Issue;
  readonly creator: Member | undefined;
  readonly project: { readonly name: string; readonly color: string } | undefined;
  readonly cycle: { readonly name: string } | undefined;
  readonly subIssueCount: number;
  readonly properties: readonly DisplayProperty[];
}

function RowMeta({ issue, creator, project, cycle, subIssueCount, properties }: RowMetaProps) {
  const shows = (property: DisplayProperty) => properties.includes(property);
  return (
    <>
      {shows('subIssues') && subIssueCount > 0 ? (
        <span data-numeric className="shrink-0 text-2xs text-faint" title="Sub-issues">
          {subIssueCount}
        </span>
      ) : null}
      {shows('project') && project !== undefined ? (
        <Chip label={project.name} color={project.color} title="Project" />
      ) : null}
      {shows('cycle') && cycle !== undefined ? <Chip label={cycle.name} title="Cycle" /> : null}
      {shows('milestone') && issue.milestoneId !== null ? (
        <Chip label="Milestone" title="On a milestone" />
      ) : null}
      {shows('dueDate') ? <DateChip value={issue.dueDate} title="Due date" /> : null}
      {shows('started') ? <DateChip value={issue.startedAt} title="Started" /> : null}
      {shows('completed') ? <DateChip value={issue.completedAt} title="Completed" /> : null}
      {shows('created') ? <DateChip value={issue.createdAt} title="Created" /> : null}
      {shows('updated') ? <DateChip value={issue.updatedAt} title="Updated" /> : null}
      {shows('estimate') && issue.estimate !== null ? (
        <span data-numeric className="w-5 text-right text-2xs text-faint">
          {issue.estimate}
        </span>
      ) : null}
      {shows('creator') && creator !== undefined ? (
        <Avatar name={creator.name} src={creator.image} size="xs" />
      ) : null}
    </>
  );
}
