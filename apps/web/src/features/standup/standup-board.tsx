'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { SearchX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { DisplayMenu } from '@/features/filters/display-menu.tsx';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import { Board } from '@/features/issues/board.tsx';
import { IssuePeek } from '@/features/issues/issue-peek.tsx';
import { useIssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { useAllIssues } from '@/lib/query/use-issues.ts';
import { PersonTiles } from './person-tiles.tsx';

const NO_ISSUES: readonly Issue[] = [];
const WHOLE_WORKSPACE: Readonly<Record<string, string>> = {};

export function assigneeCounts(issues: readonly Issue[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const assigneeId = issue.assigneeId;
    if (assigneeId === null) continue;
    counts.set(assigneeId, (counts.get(assigneeId) ?? 0) + 1);
  }
  return counts;
}

export function StandupBoard() {
  const workspace = useWorkspace();
  const { config, setConfig } = useViewConfig(null, 'board', 'standup');
  const controls = useProvideViewControls('standup', 'board', config);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const query = useMemo(
    () => ({ filter: config.filter, orderBy: config.orderBy }),
    [config.filter, config.orderBy],
  );

  const scope = useMemo(
    () => (selectedId === null ? WHOLE_WORKSPACE : { assigneeId: selectedId }),
    [selectedId],
  );

  const everyone = useAllIssues(query, WHOLE_WORKSPACE);
  const active = useAllIssues(query, scope);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = active;
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        fetchNextPage().catch(() => undefined);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const rows = useMemo(() => active.data ?? NO_ISSUES, [active.data]);
  const counts = useMemo(() => assigneeCounts(everyone.data ?? NO_ISSUES), [everyone.data]);

  const model = useIssueViewModel({
    teamId: null,
    config,
    issues: rows,
    scopeToTeam: false,
    scope,
  });

  const roster = useMemo(
    () => [...workspace.members].sort((left, right) => left.name.localeCompare(right.name)),
    [workspace.members],
  );

  if (!workspace.ready) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  const empty = model.groups.every((group) => group.issues.length === 0);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="standup-board">
      <div className="flex flex-wrap items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">Standup</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {model.total}
        </span>
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <PersonTiles
            members={roster}
            selectedId={selectedId}
            counts={counts}
            onSelect={setSelectedId}
          />
          <DisplayMenu
            config={config}
            capability={controls.capability}
            modified={controls.displayModified}
            onChange={setConfig}
          />
        </div>
      </div>

      <StandupBody
        loading={active.isPending}
        empty={empty}
        groups={model.groups}
        properties={config.display.properties}
        hasMore={hasNextPage}
        loadingMore={isFetchingNextPage}
        onLoadMore={() => {
          fetchNextPage().catch(() => undefined);
        }}
      />

      <HiddenFooter
        hiddenByFilters={model.hiddenByFilters}
        hiddenByDisplay={model.hiddenByDisplay}
        onClearFilters={() => undefined}
        onRevealDisplay={() =>
          setConfig({
            ...config,
            display: { ...config.display, showSubIssues: true, showCompleted: 'all' },
          })
        }
      />

      <IssuePeek
        issue={rows.find((issue) => issue.id === peekId)}
        onClose={() => setPeekId(null)}
      />
    </div>
  );
}

interface StandupBodyProps {
  readonly loading: boolean;
  readonly empty: boolean;
  readonly groups: readonly IssueGroup[];
  readonly properties: readonly DisplayProperty[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
}

function StandupBody({
  loading,
  empty,
  groups,
  properties,
  hasMore,
  loadingMore,
  onLoadMore,
}: StandupBodyProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-2/3" />
      </div>
    );
  }

  if (empty) {
    return (
      <EmptyState
        icon={<SearchX strokeWidth={1.75} aria-hidden="true" />}
        title="Nothing on the board"
        description="Assign an issue and it shows up here for whoever owns it."
        className="flex-1"
      />
    );
  }

  return (
    <div className="min-h-0 flex-1" data-testid="standup-kanban">
      <Board
        groups={groups}
        properties={properties}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}
