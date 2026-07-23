'use client';

import { dropLastPredicate } from '@orbit/shared/filters';
import { Columns3, List, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { groupIssues } from '@/features/filters/grouping.ts';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import type { ViewConfig, ViewLayoutMode } from '@/features/filters/view-config.ts';
import { cn } from '@/lib/cn.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';
import type { WorkflowState } from '@/lib/query/schemas.ts';
import { useIssues } from '@/lib/query/use-issues.ts';
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
  const team = workspace.teams.find((entry) => entry.key.toLowerCase() === teamKey.toLowerCase());
  const teamId = team?.id ?? null;

  const { config, setConfig } = useViewConfig(teamId, layout);
  const filtered = config.predicates.length > 0;

  const seed = workspace.seedIssues.filter((issue) => issue.teamId === teamId);
  const issues = useIssues(teamId, filtered || seed.length === 0 ? undefined : seed, {
    predicates: config.predicates,
    orderBy: config.orderBy,
    includeSubIssues: config.showSubIssues,
  });

  const states = useMemo(() => statesForTeam(workspace.states, teamId), [workspace.states, teamId]);
  const rows = useMemo(() => issues.data ?? [], [issues.data]);
  const groups = useMemo(
    () =>
      groupIssues(
        rows,
        config.groupBy,
        {
          states,
          members: workspace.members,
          projects: workspace.projects,
          cycles: workspace.cycles.filter((cycle) => cycle.teamId === teamId),
          labels: workspace.labels,
        },
        { showEmptyGroups: config.showEmptyGroups, ordering: config.orderBy },
      ),
    [rows, config.groupBy, config.showEmptyGroups, config.orderBy, states, workspace, teamId],
  );

  const other = layout === 'board' ? 'issues' : 'board';
  useHotkey(
    'mod+b',
    () => {
      router.push(`/team/${teamKey.toLowerCase()}/${other}`);
    },
    { label: 'Toggle board and list', section: 'View' },
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">{team.name}</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {rows.length}
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
      />

      <TeamContent
        teamId={teamId}
        states={states}
        groups={groups}
        config={config}
        layout={layout}
        empty={rows.length === 0}
        loading={issues.isPending}
        onClearLastFilter={() =>
          setConfig({ ...config, predicates: dropLastPredicate(config.predicates) })
        }
      />
    </div>
  );
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

  if (empty && config.predicates.length > 0) {
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
        properties={config.properties}
      />
    );
  }
  return (
    <IssueList teamId={teamId} states={states} groups={groups} properties={config.properties} />
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
