'use client';

import type { DisplayProperty } from '@orbit/shared/filters';
import { conditionsOf, dropLastCondition } from '@orbit/shared/filters';
import { Columns3, List, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import { Board } from '@/features/issues/board.tsx';
import { IssueList } from '@/features/issues/issue-list.tsx';
import { ListSkeleton } from '@/features/issues/list-skeleton.tsx';
import type { IssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useIssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { cn } from '@/lib/cn.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { useProjectIssues } from '@/lib/query/use-issues.ts';

export function soleTeamOf(issues: readonly Issue[]): string | null {
  const teams = new Set(issues.map((issue) => issue.teamId));
  if (teams.size !== 1) return null;
  const [only] = [...teams];
  return only ?? null;
}

export interface ProjectIssuesProps {
  readonly projectId: string;
  readonly projectName: string;
}

export function ProjectIssues({ projectId, projectName }: ProjectIssuesProps) {
  const workspace = useWorkspace();
  const [layout, setLayout] = useState<ViewLayoutMode>('list');
  const { config, setConfig } = useViewConfig(null, layout, 'project');
  const controls = useProvideViewControls('project', layout, config);

  const issues = useProjectIssues(projectId, {
    filter: config.filter,
    orderBy: config.orderBy,
  });
  const rows = useMemo(() => issues.data ?? [], [issues.data]);

  const scope = useMemo(() => ({ projectId }), [projectId]);
  const model = useIssueViewModel({
    teamId: null,
    config,
    issues: rows,
    scopeToTeam: false,
    scope,
  });

  const teamId = useMemo(
    () => soleTeamOf(rows) ?? workspace.teams[0]?.id ?? '',
    [rows, workspace.teams],
  );

  return (
    <section className="flex min-h-0 flex-col gap-3" data-testid="project-issues">
      <div className="flex items-center gap-2">
        <h2 className="font-medium text-dense text-text">Issues</h2>
        <span data-numeric className="text-2xs text-faint" data-testid="project-issue-count">
          {model.total}
        </span>
        <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {(['list', 'board'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={layout === mode}
              aria-label={mode === 'list' ? 'Show issues as a list' : 'Show issues as a board'}
              data-testid={`project-view-${mode}`}
              onClick={() => setLayout(mode)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs',
                'transition-colors duration-[var(--duration-fast)] motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                layout === mode ? 'bg-surface-2 text-text' : 'text-faint',
              )}
            >
              {mode === 'list' ? (
                <List className="size-3.5" aria-hidden="true" />
              ) : (
                <Columns3 className="size-3.5" aria-hidden="true" />
              )}
              {mode === 'list' ? 'List' : 'Board'}
            </button>
          ))}
        </div>
      </div>

      <FilterBar
        teamId={null}
        teamName={projectName}
        layout={layout}
        config={config}
        onChange={setConfig}
        controls={controls}
        facets={model.facets}
        showSaveView={false}
      />

      <ProjectIssueBody
        teamId={teamId}
        model={model}
        layout={layout}
        loading={issues.isPending}
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
  readonly teamId: string;
  readonly model: IssueViewModel;
  readonly layout: ViewLayoutMode;
  readonly loading: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly onClearLastFilter: () => void;
  readonly filtered: boolean;
  readonly properties: readonly DisplayProperty[];
}

function ProjectIssueBody({
  teamId,
  model,
  layout,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onClearLastFilter,
  filtered,
  properties,
}: BodyProps) {
  if (loading) return <ListSkeleton layout={layout} />;

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
        title={filtered ? 'No issues match these filters' : 'No issues in this project yet'}
        description={
          filtered
            ? 'Loosen a filter to widen the search.'
            : 'Assign an issue to this project and it will show up here.'
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
        teamId={teamId}
        groups={model.groups}
        draggable={false}
        properties={properties}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
    );
  }

  return (
    <IssueList
      teamId={teamId}
      states={model.states}
      groups={model.groups}
      properties={properties}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
    />
  );
}
