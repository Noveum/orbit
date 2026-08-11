'use client';

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
import type { BoardColumnSource } from '@/features/issues/board.tsx';
import { Board, canDragBoard } from '@/features/issues/board.tsx';
import { IssueList } from '@/features/issues/issue-list.tsx';
import { ListSkeleton } from '@/features/issues/list-skeleton.tsx';
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

  const filtered = conditionsOf(config.filter).length > 0;
  const onLoadMore = () => {
    issues.fetchNextPage().catch(() => undefined);
  };

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

      {issues.isPending ? <ListSkeleton layout={layout} /> : null}

      {!issues.isPending && model.shownCount === 0 ? (
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
              <Button
                size="sm"
                onClick={() => setConfig({ ...config, filter: dropLastCondition(config.filter) })}
              >
                Clear the last filter
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {!issues.isPending && model.shownCount > 0 && layout === 'board' ? (
        <Board
          groups={model.groups}
          draggable={canDrag}
          reorderable={config.orderBy === 'manual'}
          resolveState={resolveState}
          groupBy={config.groupBy}
          properties={config.display.properties}
          hasMore={issues.hasNextPage}
          loadingMore={issues.isFetchingNextPage}
          onLoadMore={onLoadMore}
          columnSource={columnSource}
        />
      ) : null}

      {!issues.isPending && model.shownCount > 0 && layout === 'list' ? (
        <IssueList
          states={model.states}
          groups={model.groups}
          properties={config.display.properties}
          hasMore={issues.hasNextPage}
          loadingMore={issues.isFetchingNextPage}
          onLoadMore={onLoadMore}
        />
      ) : null}
    </section>
  );
}
