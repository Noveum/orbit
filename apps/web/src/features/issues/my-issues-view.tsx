'use client';

import type { DisplayProperty, GroupByField, IssueOrdering } from '@orbit/shared/filters';
import { CircleDot } from 'lucide-react';
import type { RefObject } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { DisplayMenu } from '@/features/filters/display-menu.tsx';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { mergedStateResolver } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import { LayoutToggle } from '@/features/filters/layout-toggle.tsx';
import { useLayoutPreference } from '@/features/filters/use-layout-preference.ts';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import type { ViewLayoutMode } from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import type { Issue } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import { useAssignedIssues } from '@/lib/query/use-issues.ts';
import type { StateResolver } from './board.tsx';
import { Board, canRegroup } from './board.tsx';
import { GroupGlyph } from './group-glyph.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { IssueRow } from './issue-row.tsx';
import { LoadFailed } from './load-failed.tsx';
import { useIssueViewModel } from './use-issue-view-model.ts';
import { useWorkspace } from './workspace-provider.tsx';

export function assignedTo(
  issues: readonly Issue[],
  userId: string | null,
  ordering: IssueOrdering = 'manual',
): Issue[] {
  if (userId === null) return [];
  const mine = issues.filter((issue) => issue.assigneeId === userId);
  return ordering === 'manual' ? sortIssues(mine) : mine;
}

export function MyIssuesView() {
  const workspace = useWorkspace();
  const { layout, setLayout } = useLayoutPreference('my_issues', '', 'board');
  const { config, setConfig } = useViewConfig(null, layout, 'my_issues');
  const controls = useProvideViewControls('my_issues', layout, config);

  const assigned = useAssignedIssues(workspace.userId, {
    filter: config.filter,
    orderBy: config.orderBy,
  });
  const sentinel = useRef<HTMLDivElement>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = assigned;
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

  const loading = assigned.isPending;
  const mine = useMemo(
    () => assignedTo(assigned.data ?? [], workspace.userId, config.orderBy),
    [assigned.data, workspace.userId, config.orderBy],
  );

  const scope = useMemo(
    () => (workspace.userId === null ? {} : { assigneeId: workspace.userId }),
    [workspace.userId],
  );
  const model = useIssueViewModel({
    teamId: null,
    config,
    issues: mine,
    scopeToTeam: false,
    scope,
  });
  const groups = model.groups;
  const resolveState = useMemo(() => mergedStateResolver(workspace.states), [workspace.states]);

  if (!workspace.ready) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">My issues</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {model.total}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <LayoutToggle layout={layout} onChange={setLayout} />
          <DisplayMenu
            config={config}
            capability={controls.capability}
            modified={controls.displayModified}
            onChange={setConfig}
          />
        </div>
      </div>

      <MyIssuesBody
        loading={loading}
        failed={assigned.isError}
        onRetry={() => {
          assigned.refetch().catch(() => undefined);
        }}
        loadingMore={isFetchingNextPage}
        onLoadMore={() => {
          fetchNextPage().catch(() => undefined);
        }}
        layout={layout}
        model={model}
        groups={groups}
        groupBy={config.groupBy}
        orderBy={config.orderBy}
        resolveState={resolveState}
        properties={config.display.properties}
        workspace={workspace}
        peekId={peekId}
        onPeek={setPeekId}
        hasNextPage={hasNextPage}
        sentinel={sentinel}
      />

      <HiddenFooter
        hiddenByFilters={model.hiddenByFilters}
        hiddenByDisplay={model.hiddenByDisplay}
        onClearFilters={() => setConfig({ ...config, filter: { ...config.filter, children: [] } })}
        onRevealDisplay={() =>
          setConfig({
            ...config,
            display: { ...config.display, showSubIssues: true, showCompleted: 'all' },
          })
        }
      />

      <IssuePeek
        issueId={peekId}
        issue={mine.find((issue) => issue.id === peekId)}
        onClose={() => setPeekId(null)}
      />
    </div>
  );
}

interface BodyProps {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly layout: ViewLayoutMode;
  readonly model: ReturnType<typeof useIssueViewModel>;
  readonly groups: readonly IssueGroup[];
  readonly groupBy: GroupByField;
  readonly orderBy: IssueOrdering;
  readonly resolveState: StateResolver;
  readonly properties: readonly DisplayProperty[];
  readonly workspace: ReturnType<typeof useWorkspace>;
  readonly peekId: string | null;
  readonly onPeek: (id: string) => void;
  readonly hasNextPage: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly sentinel: RefObject<HTMLDivElement | null>;
}

function MyIssuesBody({
  loading,
  failed,
  onRetry,
  layout,
  model,
  groups,
  groupBy,
  orderBy,
  resolveState,
  properties,
  workspace,
  peekId,
  onPeek,
  hasNextPage,
  loadingMore,
  onLoadMore,
  sentinel,
}: BodyProps) {
  if (failed) {
    return <LoadFailed subject="your issues" onRetry={onRetry} testId="retry-my-issues" />;
  }

  if (model.shownCount === 0) {
    return (
      <EmptyState
        icon={<CircleDot strokeWidth={1.75} aria-hidden="true" />}
        title={loading ? 'Loading your issues' : 'Nothing assigned to you'}
        description="Issues assigned to you across every team show up here. Press C to create one."
        className="flex-1"
      />
    );
  }

  if (layout === 'board') {
    return (
      <div className="min-h-0 flex-1 overflow-hidden" data-testid="my-issues-board">
        <Board
          groups={groups}
          draggable={canRegroup(groupBy)}
          reorderable={orderBy === 'manual'}
          groupBy={groupBy}
          resolveState={resolveState}
          properties={properties}
          hasMore={hasNextPage}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="my-issues-list">
      {groups.map((group) => (
        <section key={group.id}>
          <div
            className="flex h-8 items-center gap-2 border-border border-b bg-surface-2/60 px-3"
            data-testid={`issue-group-${group.title}`}
          >
            <GroupGlyph group={group} />
            <h2 className="font-medium text-dense text-text">{group.title}</h2>
            <span data-numeric className="text-2xs text-faint">
              {group.issues.length}
            </span>
          </div>
          {group.issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              state={workspace.stateById.get(issue.stateId)}
              properties={properties}
              labels={issue.labelIds.flatMap((id) => {
                const label = workspace.labelById.get(id);
                return label === undefined ? [] : [label];
              })}
              assignee={
                issue.assigneeId === null ? undefined : workspace.memberById.get(issue.assigneeId)
              }
              creator={workspace.memberById.get(issue.creatorId)}
              active={peekId === issue.id}
              selected={false}
              onOpen={() => onPeek(issue.id)}
              onFocus={() => undefined}
              onToggleSelected={() => undefined}
            />
          ))}
        </section>
      ))}
      {hasNextPage ? <div ref={sentinel} className="h-px" aria-hidden="true" /> : null}
    </div>
  );
}
