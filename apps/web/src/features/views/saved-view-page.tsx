'use client';

import { conditionsOf, viewStateDirty } from '@orbit/shared/filters';
import { Columns3, LayoutList, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import { LayoutToggle } from '@/features/filters/layout-toggle.tsx';
import type { ViewConfig, ViewLayoutMode, ViewPage } from '@/features/filters/view-config.ts';
import {
  applyCapabilities,
  viewConfigFromState,
  viewConfigToState,
} from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import { Board } from '@/features/issues/board.tsx';
import { IssueList } from '@/features/issues/issue-list.tsx';
import { ListSkeleton } from '@/features/issues/list-skeleton.tsx';
import { useIssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { viewLayoutMode } from '@/features/views/view-href.ts';
import type { ResolvedViewScope } from '@/features/views/view-scope.ts';
import { resolveViewScope } from '@/features/views/view-scope.ts';
import { ViewsSkeleton } from '@/features/views/views-skeleton.tsx';
import type { View, WorkflowState } from '@/lib/query/schemas.ts';
import { useAllIssues } from '@/lib/query/use-issues.ts';
import { useViews } from '@/lib/query/use-views.ts';

export interface SavedViewPageProps {
  readonly viewId: string;
}

export function SavedViewPage({ viewId }: SavedViewPageProps) {
  const views = useViews();
  const view = (views.data ?? []).find((entry) => entry.id === viewId);

  if (views.isPending) return <ViewsSkeleton />;
  if (view === undefined) {
    return (
      <EmptyState
        icon={<LayoutList strokeWidth={1.75} aria-hidden="true" />}
        title="No such view"
        description="It was deleted, or it was never shared with you."
      />
    );
  }
  return <SavedViewBody key={view.id} view={view} />;
}

export function viewPageOf(scope: ResolvedViewScope): ViewPage {
  return scope.project === null ? 'saved_view' : 'project';
}

const UNREADABLE_HINT =
  'Orbit could not read what this view stored, so it is showing the defaults. Save it again to replace them.';

function UnreadableNotice() {
  return (
    <Badge tone="danger" data-testid="view-unreadable" title={UNREADABLE_HINT}>
      Saved settings could not be read
    </Badge>
  );
}

function SavedViewBody({ view }: { view: View }) {
  const workspace = useWorkspace();
  const [layout, setLayout] = useState<ViewLayoutMode>(viewLayoutMode(view.layout));
  const [edited, setEdited] = useState<ViewConfig | null>(null);

  useEffect(() => {
    setEdited(null);
    setLayout(viewLayoutMode(view.layout));
  }, [view.layout]);

  const scope = useMemo(() => resolveViewScope(view, workspace), [view, workspace]);
  const page = viewPageOf(scope);
  const config = useMemo(
    () => applyCapabilities(edited ?? viewConfigFromState(view.filter), page, layout),
    [edited, view.filter, page, layout],
  );
  const controls = useProvideViewControls(page, layout, config);

  const issues = useAllIssues({ filter: config.filter, orderBy: config.orderBy }, scope.query);
  const rows = useMemo(() => issues.data ?? [], [issues.data]);

  const model = useIssueViewModel({
    teamId: scope.team?.id ?? null,
    config,
    issues: rows,
    scopeToTeam: false,
    scope: scope.query,
  });

  const stored = { teamId: view.filter.teamId, projectId: view.filter.projectId };
  const pending = viewConfigToState(config, layout, stored);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="saved-view-page">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">{view.name}</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {model.total}
        </span>
        <Badge
          tone={scope.unresolved.length === 0 ? 'outline' : 'warning'}
          data-testid="view-scope"
        >
          {scope.label}
        </Badge>
        {view.readable ? null : <UnreadableNotice />}
        <div className="ml-auto flex items-center gap-1">
          <LayoutToggle layout={layout} onChange={setLayout} />
        </div>
      </div>

      <FilterBar
        teamId={scope.team?.id ?? null}
        teamName={scope.name}
        scope={stored}
        layout={layout}
        config={config}
        onChange={(next) => setEdited(next)}
        controls={controls}
        facets={model.facets}
        savedView={view}
        dirty={viewStateDirty(pending, view.filter)}
      />

      <SavedViewContent
        states={model.states}
        groups={model.groups}
        config={config}
        layout={layout}
        empty={model.shownCount === 0}
        loading={issues.isPending}
        hasMore={issues.hasNextPage}
        loadingMore={issues.isFetchingNextPage}
        onLoadMore={() => {
          issues.fetchNextPage().catch(() => undefined);
        }}
      />

      <HiddenFooter
        hiddenByFilters={model.hiddenByFilters}
        hiddenByDisplay={model.hiddenByDisplay}
        onClearFilters={() => setEdited({ ...config, filter: { ...config.filter, children: [] } })}
        onRevealDisplay={() =>
          setEdited({
            ...config,
            display: { ...config.display, showSubIssues: true, showCompleted: 'all' },
          })
        }
      />
    </div>
  );
}

interface SavedViewContentProps {
  readonly states: readonly WorkflowState[];
  readonly groups: readonly IssueGroup[];
  readonly config: ViewConfig;
  readonly layout: ViewLayoutMode;
  readonly empty: boolean;
  readonly loading: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
}

function SavedViewContent({
  states,
  groups,
  config,
  layout,
  empty,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: SavedViewContentProps) {
  if (loading) return <ListSkeleton layout={layout} />;

  if (empty) {
    const filtered = conditionsOf(config.filter).length > 0;
    return (
      <EmptyState
        icon={
          filtered ? (
            <SearchX strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Columns3 strokeWidth={1.75} aria-hidden="true" />
          )
        }
        title="No issues match this view"
        description={
          filtered
            ? 'Loosen a filter to widen the search, then save the change.'
            : 'Press C to create the first one.'
        }
        className="flex-1"
      />
    );
  }

  if (layout === 'board') {
    return (
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="saved-view-board">
        <Board
          groups={groups}
          draggable={false}
          groupBy={config.groupBy}
          properties={config.display.properties}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="saved-view-list">
      <IssueList
        states={states}
        groups={groups}
        properties={config.display.properties}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}
