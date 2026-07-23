'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES } from '@orbit/shared/filters';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { Cycle, Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import { BulkEditBar } from './bulk-edit-bar.tsx';
import { GroupGlyph } from './group-glyph.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { IssueRow, ROW_HEIGHT } from './issue-row.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export const HEADER_HEIGHT = 32;

export type Row =
  | { readonly kind: 'header'; readonly group: IssueGroup }
  | { readonly kind: 'subheader'; readonly title: string; readonly count: number }
  | { readonly kind: 'issue'; readonly issue: Issue; readonly state: WorkflowState | undefined };

export function buildRows(
  groups: readonly IssueGroup[],
  stateById: ReadonlyMap<string, WorkflowState>,
): Row[] {
  const rows: Row[] = [];
  for (const group of groups) {
    rows.push({ kind: 'header', group });
    if (group.subGroups.length === 0) {
      for (const issue of group.issues) {
        rows.push({ kind: 'issue', issue, state: stateById.get(issue.stateId) });
      }
      continue;
    }
    for (const sub of group.subGroups) {
      rows.push({ kind: 'subheader', title: sub.title, count: sub.issues.length });
      for (const issue of sub.issues) {
        rows.push({ kind: 'issue', issue, state: stateById.get(issue.stateId) });
      }
    }
  }
  return rows;
}

export interface IssueListProps {
  readonly teamId: string;
  readonly states: readonly WorkflowState[];
  readonly groups: readonly IssueGroup[];
  readonly properties?: readonly DisplayProperty[];
}

export function IssueList({
  teamId,
  states,
  groups,
  properties = DEFAULT_DISPLAY_PROPERTIES,
}: IssueListProps) {
  const router = useRouter();
  const { labelById, memberById, stateById, projects, cycles } = useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [peekId, setPeekId] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(groups, stateById), [groups, stateById]);
  const issues = useMemo(() => groups.flatMap((group) => [...group.issues]), [groups]);
  const issueIndexes = useMemo(
    () => rows.flatMap((row, index) => (row.kind === 'issue' ? [index] : [])),
    [rows],
  );
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.parentId === null) continue;
      counts.set(issue.parentId, (counts.get(issue.parentId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const cycleById = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle])), [cycles]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'issue' ? ROW_HEIGHT : HEADER_HEIGHT),
    overscan: 12,
  });

  const activeRow = rows[activeIndex];
  const activeIssue = activeRow?.kind === 'issue' ? activeRow.issue : undefined;

  const step = useCallback(
    (direction: 1 | -1) => {
      const position = issueIndexes.indexOf(activeIndex);
      const fallback = direction === 1 ? 0 : issueIndexes.length - 1;
      const nextPosition =
        position === -1
          ? fallback
          : Math.min(Math.max(position + direction, 0), issueIndexes.length - 1);
      const nextIndex = issueIndexes[nextPosition];
      if (nextIndex === undefined) return;
      setActiveIndex(nextIndex);
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    },
    [activeIndex, issueIndexes, virtualizer],
  );

  useEffect(() => {
    if (activeIssue === undefined && issueIndexes[0] !== undefined) setActiveIndex(issueIndexes[0]);
  }, [activeIssue, issueIndexes]);

  useHotkey('j', () => step(1), { label: 'Next issue', section: 'Issues', scope: 'issues' });
  useHotkey('k', () => step(-1), { label: 'Previous issue', section: 'Issues', scope: 'issues' });
  useHotkey(
    'x',
    () => {
      if (activeIssue === undefined) return;
      setSelected((current) =>
        current.includes(activeIssue.id)
          ? current.filter((id) => id !== activeIssue.id)
          : [...current, activeIssue.id],
      );
    },
    { label: 'Select issue', section: 'Issues', scope: 'issues' },
  );
  useHotkey(
    'space',
    () => {
      if (activeIssue !== undefined) setPeekId(activeIssue.id);
    },
    { label: 'Peek issue', section: 'Issues', scope: 'issues' },
  );
  useHotkey(
    'enter',
    () => {
      if (activeIssue !== undefined) router.push(`/issue/${activeIssue.identifier}`);
    },
    { label: 'Open issue', section: 'Issues', scope: 'issues' },
  );
  useHotkey(
    'escape',
    () => {
      if (peekId !== null) {
        setPeekId(null);
        return;
      }
      setSelected([]);
    },
    {
      label: 'Close the peek, then clear the selection',
      section: 'Issues',
      scope: 'issues',
      preventDefault: false,
    },
  );

  const peekIssue = issues.find((issue) => issue.id === peekId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="issue-list">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (row === undefined) return null;
            return (
              <div
                key={item.key}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
                className={row.kind === 'issue' ? undefined : 'z-10 bg-bg'}
              >
                <ListRow
                  row={row}
                  properties={properties}
                  active={item.index === activeIndex}
                  selected={selected}
                  labelById={labelById}
                  memberById={memberById}
                  projectById={projectById}
                  cycleById={cycleById}
                  childCounts={childCounts}
                  onOpen={(identifier) => router.push(`/issue/${identifier}`)}
                  onFocus={() => setActiveIndex(item.index)}
                  onToggleSelected={(id) =>
                    setSelected((current) =>
                      current.includes(id)
                        ? current.filter((entry) => entry !== id)
                        : [...current, id],
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {selected.length > 0 ? (
        <BulkEditBar
          teamId={teamId}
          states={states}
          issues={issues.filter((issue) => selected.includes(issue.id))}
          onClear={() => setSelected([])}
        />
      ) : null}

      <IssuePeek
        issue={peekIssue}
        onClose={() => setPeekId(null)}
        onOpen={() => {
          if (peekIssue !== undefined) router.push(`/issue/${peekIssue.identifier}`);
        }}
      />
    </div>
  );
}

interface ListRowProps {
  readonly row: Row;
  readonly properties: readonly DisplayProperty[];
  readonly active: boolean;
  readonly selected: readonly string[];
  readonly labelById: ReadonlyMap<string, Label>;
  readonly memberById: ReadonlyMap<string, Member>;
  readonly projectById: ReadonlyMap<string, Project>;
  readonly cycleById: ReadonlyMap<string, Cycle>;
  readonly childCounts: ReadonlyMap<string, number>;
  readonly onOpen: (identifier: string) => void;
  readonly onFocus: () => void;
  readonly onToggleSelected: (id: string) => void;
}

function ListRow({
  row,
  properties,
  active,
  selected,
  labelById,
  memberById,
  projectById,
  cycleById,
  childCounts,
  onOpen,
  onFocus,
  onToggleSelected,
}: ListRowProps) {
  if (row.kind === 'subheader') {
    return (
      <div
        className="flex h-8 items-center gap-2 border-border border-b bg-surface/60 pr-3 pl-8"
        data-testid={`issue-sub-group-${row.title}`}
      >
        <h3 className="font-medium text-2xs text-muted uppercase tracking-wide">{row.title}</h3>
        <span data-numeric className="text-2xs text-faint">
          {row.count}
        </span>
      </div>
    );
  }

  if (row.kind === 'header') {
    return (
      <div
        className="flex h-8 items-center gap-2 border-border border-b bg-surface-2/60 px-3"
        data-testid={`issue-group-${row.group.title}`}
      >
        <GroupGlyph group={row.group} />
        <h2 className="font-medium text-dense text-text">{row.group.title}</h2>
        <span data-numeric className="text-2xs text-faint">
          {row.group.issues.length}
        </span>
      </div>
    );
  }

  const issue = row.issue;
  return (
    <IssueRow
      issue={issue}
      state={row.state}
      properties={properties}
      active={active}
      selected={selected.includes(issue.id)}
      labels={issue.labelIds.flatMap((id) => {
        const label = labelById.get(id);
        return label === undefined ? [] : [label];
      })}
      assignee={issue.assigneeId === null ? undefined : memberById.get(issue.assigneeId)}
      creator={memberById.get(issue.creatorId)}
      project={issue.projectId === null ? undefined : projectById.get(issue.projectId)}
      cycle={issue.cycleId === null ? undefined : cycleById.get(issue.cycleId)}
      subIssueCount={childCounts.get(issue.id) ?? 0}
      onOpen={() => onOpen(issue.identifier)}
      onFocus={onFocus}
      onToggleSelected={() => onToggleSelected(issue.id)}
    />
  );
}
