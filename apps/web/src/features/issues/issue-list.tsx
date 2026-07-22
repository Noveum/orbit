'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import { BulkEditBar } from './bulk-edit-bar.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { IssueRow, ROW_HEIGHT } from './issue-row.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

const HEADER_HEIGHT = 32;

type Row =
  | { readonly kind: 'header'; readonly state: WorkflowState; readonly count: number }
  | { readonly kind: 'issue'; readonly issue: Issue; readonly state: WorkflowState };

export function buildRows(states: readonly WorkflowState[], issues: readonly Issue[]): Row[] {
  const byState = new Map<string, Issue[]>();
  for (const issue of issues) {
    const bucket = byState.get(issue.stateId) ?? [];
    bucket.push(issue);
    byState.set(issue.stateId, bucket);
  }

  const rows: Row[] = [];
  for (const state of states) {
    const group = sortIssues(byState.get(state.id) ?? []);
    if (group.length === 0) continue;
    rows.push({ kind: 'header', state, count: group.length });
    for (const issue of group) rows.push({ kind: 'issue', issue, state });
  }
  return rows;
}

export interface IssueListProps {
  readonly teamId: string;
  readonly states: readonly WorkflowState[];
  readonly issues: readonly Issue[];
}

export function IssueList({ teamId, states, issues }: IssueListProps) {
  const router = useRouter();
  const { labelById, memberById } = useWorkspace();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [peekId, setPeekId] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(states, issues), [states, issues]);
  const issueIndexes = useMemo(
    () => rows.flatMap((row, index) => (row.kind === 'issue' ? [index] : [])),
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
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
    if (activeRow === undefined && issueIndexes[0] !== undefined) setActiveIndex(issueIndexes[0]);
  }, [activeRow, issueIndexes]);

  useHotkey('j', () => step(1), { label: 'Next issue', section: 'Issues' });
  useHotkey('k', () => step(-1), { label: 'Previous issue', section: 'Issues' });
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
    { label: 'Select issue', section: 'Issues' },
  );
  useHotkey(
    'space',
    () => {
      if (activeIssue !== undefined) setPeekId(activeIssue.id);
    },
    { label: 'Peek issue', section: 'Issues' },
  );
  useHotkey(
    'enter',
    () => {
      if (activeIssue !== undefined) router.push(`/issue/${activeIssue.identifier}`);
    },
    { label: 'Open issue', section: 'Issues' },
  );
  useHotkey(
    'escape',
    () => {
      setSelected([]);
      setPeekId(null);
    },
    { label: 'Clear selection', section: 'Issues' },
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
                className={row.kind === 'header' ? 'z-10 bg-bg' : undefined}
              >
                {row.kind === 'header' ? (
                  <div className="flex h-8 items-center gap-2 border-border border-b bg-surface-2/60 px-3">
                    <StateGlyph category={row.state.category} color={row.state.color} />
                    <h2 className="font-medium text-dense text-text">{row.state.name}</h2>
                    <span data-numeric className="text-2xs text-faint">
                      {row.count}
                    </span>
                  </div>
                ) : (
                  <IssueRow
                    issue={row.issue}
                    state={row.state}
                    active={item.index === activeIndex}
                    selected={selected.includes(row.issue.id)}
                    labels={row.issue.labelIds.flatMap((id) => {
                      const label = labelById.get(id);
                      return label === undefined ? [] : [label];
                    })}
                    assignee={
                      row.issue.assigneeId === null
                        ? undefined
                        : memberById.get(row.issue.assigneeId)
                    }
                    onOpen={() => router.push(`/issue/${row.issue.identifier}`)}
                    onFocus={() => setActiveIndex(item.index)}
                    onToggleSelected={() =>
                      setSelected((current) =>
                        current.includes(row.issue.id)
                          ? current.filter((id) => id !== row.issue.id)
                          : [...current, row.issue.id],
                      )
                    }
                  />
                )}
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
