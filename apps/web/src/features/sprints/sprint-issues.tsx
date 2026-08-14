'use client';

import type { DisplayProperty, GroupByField, IssueOrdering } from '@orbit/shared/filters';
import { conditionsOf, dropLastCondition } from '@orbit/shared/filters';
import { Columns3, SearchX } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import { mergedStateResolver } from '@/features/filters/grouping.ts';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import type { BoardColumnSource, StateResolver } from '@/features/issues/board.tsx';
import { Board, canDragBoard } from '@/features/issues/board.tsx';
import { IssueList } from '@/features/issues/issue-list.tsx';
import { ListSkeleton } from '@/features/issues/list-skeleton.tsx';
import { LoadFailed } from '@/features/issues/load-failed.tsx';
import type { IssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useIssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { columnParamFor } from '@/lib/query/issue-search.ts';
import { useCycleIssues } from '@/lib/query/use-issues.ts';

export interface SprintIssuesProps {
  readonly cycleId: string;
  readonly sprintName: string;
  readonly layout: ViewLayoutMode;
}

export function SprintIssues({ cycleId, sprintName, layout }: SprintIssuesProps) {
  const { config, setConfig } = useViewConfig(null, layout, 'cycle');
  const controls = useProvideViewControls('cycle', layout, config);

  const issues = useCycleIssues(cycleId, { filter: config.filter, orderBy: config.orderBy });
  const rows = useMemo(() => issues.data ?? [], [issues.data]);

  const workspace = useWorkspace();
  const canDrag = canDragBoard(workspace.role, config.groupBy);
  const resolveState = useMemo(() => mergedStateResolver(workspace.states), [workspace.states]);
  const scope = useMemo(() => ({ cycleId }), [cycleId]);
  const columnSource = useMemo<BoardColumnSource | undefined>(
    () =>
      config.groupBy === 'state' || columnParamFor(config.groupBy) === null
        ? undefined
        : {
            query: { filter: config.filter, orderBy: config.orderBy },
            groupBy: config.groupBy,
            scope,
            display: config.display,
          },
    [config.groupBy, config.filter, config.orderBy, config.display, scope],
  );
  const model = useIssueViewModel({
    teamId: null,
    config,
    issues: rows,
    scopeToTeam: false,
    scope,
  });

  return (
    <section className="flex min-h-0 flex-col gap-3" data-testid="sprint-issues">
      <FilterBar
        teamId={null}
        teamName={sprintName}
        scope={{ teamId: null, projectId: null }}
        layout={layout}
        config={config}
        onChange={setConfig}
        controls={controls}
        facets={model.facets}
        showSaveView={false}
      />

      <SprintIssueBody
        model={model}
        layout={layout}
        groupBy={config.groupBy}
        orderBy={config.orderBy}
        resolveState={resolveState}
        columnSource={columnSource}
        canDrag={canDrag}
        loading={issues.isPending}
        failed={issues.isError}
        onRetry={() => {
          issues.refetch().catch(() => undefined);
        }}
        hasMore={issues.hasNextPage}
        loadingMore={issues.isFetchingNextPage}
        onLoadMore={() => {
          issues.fetchNextPage().catch(() => undefined);
        }}
        onClearLastFilter={() => setConfig({ ...config, filter: dropLastCondition(config.filter) })}
        filtered={conditionsOf(config.filter).length > 0}
        properties={config.display.properties}
      />
    </section>
  );
}

interface BodyProps {
  readonly model: IssueViewModel;
  readonly columnSource: BoardColumnSource | undefined;
  readonly canDrag: boolean;
  readonly groupBy: GroupByField;
  readonly orderBy: IssueOrdering;
  readonly resolveState: StateResolver;
  readonly layout: ViewLayoutMode;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly onClearLastFilter: () => void;
  readonly filtered: boolean;
  readonly properties: readonly DisplayProperty[];
}

function SprintIssueBody({
  model,
  columnSource,
  canDrag,
  groupBy,
  orderBy,
  resolveState,
  layout,
  loading,
  failed,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  onClearLastFilter,
  filtered,
  properties,
}: BodyProps) {
  if (loading) return <ListSkeleton layout={layout} />;

  if (failed) {
    return <LoadFailed subject="this sprint" onRetry={onRetry} testId="retry-sprint-issues" />;
  }

  if (model.shownCount === 0) {
    return (
      <EmptyState
        icon={
          filtered ? (
            <SearchX strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Columns3 strokeWidth={1.75} aria-hidden="true" />
          )
        }
        title={filtered ? 'No tasks match these filters' : 'Nothing in this sprint yet'}
        description={
          filtered
            ? 'Loosen a filter to widen the search.'
            : 'Move a task into this sprint and it will show up here.'
        }
        className="flex-1"
        action={
          filtered ? (
            <Button size="sm" onClick={onClearLastFilter}>
              Clear the last filter
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (layout === 'board') {
    return (
      <Board
        groups={model.groups}
        draggable={canDrag}
        reorderable={orderBy === 'manual'}
        resolveState={resolveState}
        groupBy={groupBy}
        properties={properties}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        columnSource={columnSource}
      />
    );
  }

  return (
    <IssueList
      states={model.states}
      groups={model.groups}
      properties={properties}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    />
  );
}
