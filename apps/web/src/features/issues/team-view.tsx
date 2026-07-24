'use client';

import {
  conditionsOf,
  dropLastCondition,
  isEmptyFilter,
  viewStateDirty,
} from '@orbit/shared/filters';
import { useQuery } from '@tanstack/react-query';
import { Columns3, List, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { applyDisplayFilters } from '@/features/filters/display-filter.ts';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { groupIssues } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import { useViewConfig, VIEW_PARAM } from '@/features/filters/use-view-config.ts';
import type { ViewConfig, ViewLayoutMode } from '@/features/filters/view-config.ts';
import { viewConfigToState } from '@/features/filters/view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { View, WorkflowState } from '@/lib/query/schemas.ts';
import { teamIssuesQuery, useIssues } from '@/lib/query/use-issues.ts';
import { useViews } from '@/lib/query/use-views.ts';
import { Board } from './board.tsx';
import { IssueList } from './issue-list.tsx';
import { ListSkeleton } from './list-skeleton.tsx';
import { statesForTeam, useWorkspace } from './workspace-provider.tsx';

export interface TeamViewProps {
  readonly teamKey: string;
  readonly layout: ViewLayoutMode;
}

export function TeamView({ teamKey, layout }: TeamViewProps) {
  const router = useRouter();
  const workspace = useWorkspace();
  const searchParams = useSearchParams();
  const team = workspace.teams.find((entry) => entry.key.toLowerCase() === teamKey.toLowerCase());
  const teamId = team?.id ?? null;

  const { config, setConfig } = useViewConfig(teamId, layout, 'team');
  const controls = useProvideViewControls('team', layout, config, setConfig);
  const filtered = !isEmptyFilter(config.filter);

  const seed = workspace.seedIssues.filter((issue) => issue.teamId === teamId);
  const issues = useIssues(teamId, filtered || seed.length === 0 ? undefined : seed, {
    filter: config.filter,
    orderBy: config.orderBy,
  });

  const unfiltered = useQuery({
    ...teamIssuesQuery(teamId ?? 'none'),
    enabled: teamId !== null && filtered,
  });

  const views = useViews();
  const savedView = useSavedView(views.data ?? [], searchParams.get(VIEW_PARAM));

  const states = useMemo(() => statesForTeam(workspace.states, teamId), [workspace.states, teamId]);
  const rows = useMemo(() => issues.data ?? [], [issues.data]);

  const shown = useMemo(
    () => applyDisplayFilters(rows, config.display, workspace.stateById),
    [rows, config.display, workspace.stateById],
  );

  const groups = useMemo(
    () =>
      groupIssues(
        shown.issues,
        config.groupBy,
        {
          states,
          members: workspace.members,
          projects: workspace.projects,
          cycles: workspace.cycles.filter((cycle) => cycle.teamId === teamId),
          labels: workspace.labels,
        },
        {
          showEmptyGroups: config.display.showEmptyGroups,
          ordering: config.orderBy,
          subGroupBy: config.subGroupBy,
        },
      ),
    [
      shown.issues,
      config.groupBy,
      config.display.showEmptyGroups,
      config.orderBy,
      config.subGroupBy,
      states,
      workspace,
      teamId,
    ],
  );

  const hiddenByFilters =
    filtered && unfiltered.data !== undefined
      ? Math.max(0, unfiltered.data.length - rows.length)
      : 0;

  const other = layout === 'board' ? 'issues' : 'board';
  useHotkey(
    'mod+b',
    () => {
      router.push(`/team/${teamKey.toLowerCase()}/${other}`);
    },
    { label: 'Toggle board and list', section: 'View', scope: 'issues' },
  );

  if (!workspace.ready) return <ListSkeleton layout={layout} />;

  if (team === undefined || teamId === null) {
    return (
      <EmptyState
        icon={<List strokeWidth={1.75} aria-hidden="true" />}
        title="No such team"
        description={`Nothing here matches "${teamKey}".`}
      />
    );
  }

  const clearFilters = () => setConfig({ ...config, filter: { ...config.filter, children: [] } });
  const revealDisplay = () =>
    setConfig({
      ...config,
      display: { ...config.display, showSubIssues: true, showCompleted: 'all' },
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">{team.name}</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {shown.issues.length}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <ViewToggle teamKey={teamKey} layout={layout} />
          <Button
            size="sm"
            variant="primary"
            onClick={() => workspace.openQuickCreate(teamId)}
            data-testid="new-issue"
          >
            New issue
          </Button>
        </div>
      </div>

      <FilterBar
        teamId={teamId}
        teamName={team.name}
        layout={layout}
        config={config}
        onChange={setConfig}
        controls={controls}
        issues={unfiltered.data ?? rows}
        savedView={savedView}
        dirty={savedView !== null && isDirty(config, layout, savedView)}
      />

      <TeamContent
        teamId={teamId}
        states={states}
        groups={groups}
        config={config}
        layout={layout}
        empty={shown.issues.length === 0}
        loading={issues.isPending}
        onClearLastFilter={() => setConfig({ ...config, filter: dropLastCondition(config.filter) })}
      />

      <HiddenFooter
        hiddenByFilters={hiddenByFilters}
        hiddenByDisplay={shown.hidden}
        onClearFilters={clearFilters}
        onRevealDisplay={revealDisplay}
      />
    </div>
  );
}

function useSavedView(views: readonly View[], viewId: string | null): View | null {
  return useMemo(
    () => (viewId === null ? null : (views.find((entry) => entry.id === viewId) ?? null)),
    [views, viewId],
  );
}

function isDirty(config: ViewConfig, layout: ViewLayoutMode, view: View): boolean {
  const current = viewConfigToState(config, layout, {
    teamId: view.filter.teamId,
    projectId: view.filter.projectId,
  });
  return viewStateDirty(current, view.filter);
}

interface TeamContentProps {
  readonly teamId: string;
  readonly states: readonly WorkflowState[];
  readonly groups: readonly IssueGroup[];
  readonly config: ViewConfig;
  readonly layout: ViewLayoutMode;
  readonly empty: boolean;
  readonly loading: boolean;
  readonly onClearLastFilter: () => void;
}

function TeamContent({
  teamId,
  states,
  groups,
  config,
  layout,
  empty,
  loading,
  onClearLastFilter,
}: TeamContentProps) {
  if (loading) return <ListSkeleton layout={layout} />;

  if (empty && conditionsOf(config.filter).length > 0) {
    return (
      <EmptyState
        icon={<SearchX strokeWidth={1.75} aria-hidden="true" />}
        title="No issues match these filters"
        description="Loosen a filter to widen the search."
        className="flex-1"
        action={
          <Button size="sm" data-testid="clear-last-filter" onClick={onClearLastFilter}>
            Clear the last filter
          </Button>
        }
      />
    );
  }

  if (empty) {
    return (
      <EmptyState
        icon={<Columns3 strokeWidth={1.75} aria-hidden="true" />}
        title="No issues yet"
        description="Press C to create the first one."
        className="flex-1"
      />
    );
  }

  if (layout === 'board') {
    return (
      <Board
        teamId={teamId}
        groups={groups}
        draggable={config.groupBy === 'state' && config.orderBy === 'manual'}
        properties={config.display.properties}
      />
    );
  }
  return (
    <IssueList
      teamId={teamId}
      states={states}
      groups={groups}
      properties={config.display.properties}
    />
  );
}

function ViewToggle({ teamKey, layout }: { teamKey: string; layout: ViewLayoutMode }) {
  const base = `/team/${teamKey.toLowerCase()}`;
  const itemClass =
    'flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs transition-colors duration-[var(--duration-fast)]';

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      <Link
        href={`${base}/issues`}
        data-testid="view-list"
        className={cn(itemClass, layout === 'list' ? 'bg-surface-2 text-text' : 'text-faint')}
      >
        <List className="size-3.5" aria-hidden="true" />
        List
      </Link>
      <Link
        href={`${base}/board`}
        data-testid="view-board"
        className={cn(itemClass, layout === 'board' ? 'bg-surface-2 text-text' : 'text-faint')}
      >
        <Columns3 className="size-3.5" aria-hidden="true" />
        Board
      </Link>
    </div>
  );
}
