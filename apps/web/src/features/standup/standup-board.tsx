'use client';

import type { OrgRole } from '@orbit/shared/constants';
import type { DisplayProperty, GroupByField, IssueOrdering } from '@orbit/shared/filters';
import { Bot, ChevronDown, SearchX } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { FilterBar } from '@/features/filters/filter-bar.tsx';
import { type IssueGroup, mergedStateResolver } from '@/features/filters/grouping.ts';
import { HiddenFooter } from '@/features/filters/hidden-footer.tsx';
import { useViewConfig } from '@/features/filters/use-view-config.ts';
import { useProvideViewControls } from '@/features/filters/view-controls.tsx';
import {
  Board,
  boardVisibilityConfig,
  canDragBoard,
  type StateResolver,
  useBoardVisibilityHold,
} from '@/features/issues/board.tsx';
import { LoadFailed } from '@/features/issues/load-failed.tsx';
import { useIssueViewModel } from '@/features/issues/use-issue-view-model.ts';
import { useWorkspace } from '@/features/issues/workspace-provider.tsx';
import { summarySearch } from '@/lib/query/issue-search.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { useAllIssues, useIssueSummary } from '@/lib/query/use-issues.ts';
import { MemberPicker } from './member-picker.tsx';
import { UNASSIGNED } from './person-tiles.tsx';

const NO_ISSUES: readonly Issue[] = [];
const WORK_TYPES = { all: 'All work', reviewing: 'To review', assigned: 'Assigned' } as const;
type WorkType = keyof typeof WORK_TYPES;
function workTypeOf(value: string | null): WorkType {
  return value === 'reviewing' || value === 'assigned' ? value : 'all';
}

export const PERSON_PARAM = 'person';

const CARRIED_PARAMS: readonly string[] = [PERSON_PARAM, 'workType', 'aiOnly'];

export function standupBoardOptions(role: OrgRole, groupBy: GroupByField, orderBy: IssueOrdering) {
  return {
    draggable: canDragBoard(role, groupBy),
    groupBy,
    reorderable: orderBy === 'manual',
  };
}

export function StandupBoard() {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { config, setConfig } = useViewConfig(null, 'board', 'standup', CARRIED_PARAMS);
  const controls = useProvideViewControls('standup', 'board', config);

  const [chosen, setChosen] = useState<string | null>(() => searchParams.get(PERSON_PARAM));

  const [workType, setWorkType] = useState<WorkType>(() =>
    workTypeOf(searchParams.get('workType')),
  );
  const [aiOnly, setAiOnly] = useState(() => searchParams.get('aiOnly') === 'true');

  const urlPerson = searchParams.get(PERSON_PARAM);
  const urlWorkType = searchParams.get('workType');
  const urlAiOnly = searchParams.get('aiOnly');
  useEffect(() => {
    setChosen(urlPerson);
    setWorkType(workTypeOf(urlWorkType));
    setAiOnly(urlAiOnly === 'true');
  }, [urlPerson, urlWorkType, urlAiOnly]);

  const known =
    chosen === null ||
    chosen === UNASSIGNED ||
    workspace.members.some((member) => member.id === chosen);
  const selectedId = known ? chosen : null;

  const selectPerson = useCallback(
    (next: string | null) => {
      setChosen(next);
      const params = new URLSearchParams(window.location.search);
      if (next === null) params.delete(PERSON_PARAM);
      else params.set(PERSON_PARAM, next);
      const search = params.toString();
      window.history.replaceState(
        null,
        '',
        `${pathname}${search.length === 0 ? '' : `?${search}`}`,
      );
    },
    [pathname],
  );

  function selectFilter(key: 'workType' | 'aiOnly', value: string) {
    if (key === 'workType') setWorkType(workTypeOf(value));
    else setAiOnly(value === 'true');
    const params = new URLSearchParams(window.location.search);
    if (value === 'all' || value === 'false') params.delete(key);
    else params.set(key, value);
    window.history.replaceState(null, '', `${pathname}${params.size ? `?${params}` : ''}`);
  }

  const query = useMemo(
    () => ({ filter: config.filter, orderBy: config.orderBy }),
    [config.filter, config.orderBy],
  );

  const rosterScope = useMemo<Readonly<Record<string, string>>>(
    () => ({ workType, aiOnly: String(aiOnly) }),
    [workType, aiOnly],
  );
  const scope = useMemo<Readonly<Record<string, string>>>(
    () => ({ ...rosterScope, ...(selectedId === null ? {} : { participantId: selectedId }) }),
    [selectedId, rosterScope],
  );

  const active = useAllIssues(query, scope, workspace.ready);
  const roster = useIssueSummary(
    summarySearch(null, query, 'participant', rosterScope),
    workspace.ready,
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = active;
  const rows = useMemo(() => active.data ?? NO_ISSUES, [active.data]);
  const counts = roster.isError ? null : (roster.data?.groupTotals ?? null);

  const model = useIssueViewModel({
    teamId: null,
    config,
    issues: rows,
    scopeToTeam: false,
    scope,
  });
  const boardVisibility = useBoardVisibilityHold(
    JSON.stringify([selectedId, workType, aiOnly, boardVisibilityConfig(config), workspace.role]),
    model.shownCount === 0,
  );

  const resolveState = useMemo(() => mergedStateResolver(workspace.states), [workspace.states]);

  const members = useMemo(
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
  const boardOptions = standupBoardOptions(workspace.role, config.groupBy, config.orderBy);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="standup-board">
      <div className="flex flex-wrap items-center gap-2 border-border border-b px-3 py-2">
        <h1 className="font-medium text-dense text-text">Standup</h1>
        <span data-numeric className="text-2xs text-faint" data-testid="issue-count">
          {model.total}
        </span>
        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant={aiOnly ? 'primary' : 'secondary'}
            aria-pressed={aiOnly}
            onClick={() => selectFilter('aiOnly', String(!aiOnly))}
            title="Tasks with AI agent involvement, including creation, assignment, reviews, comments, reactions, and activity"
          >
            <Bot className="size-3.5" aria-hidden="true" />
            AI only
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Work type: ${WORK_TYPES[workType]}`}
              >
                {WORK_TYPES[workType]}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={workType}
                onValueChange={(value) => selectFilter('workType', value)}
              >
                {Object.entries(WORK_TYPES).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <MemberPicker
            members={members}
            currentUserId={workspace.userId}
            selectedId={selectedId}
            counts={counts}
            onSelect={selectPerson}
          />
        </div>
      </div>

      <FilterBar
        teamId={null}
        teamName="Standup"
        layout="board"
        config={config}
        onChange={setConfig}
        controls={controls}
        facets={model.facets}
        showSaveView={false}
      />

      <StandupBody
        key={boardVisibility.key}
        loading={active.isPending}
        failed={active.isError}
        onRetry={() => {
          active.refetch().catch(() => undefined);
        }}
        empty={empty}
        groups={model.groups}
        filtered={model.filtered}
        {...boardOptions}
        properties={config.display.properties}
        hasMore={hasNextPage}
        loadingMore={isFetchingNextPage}
        resolveState={resolveState}
        onLoadMore={() => {
          fetchNextPage().catch(() => undefined);
        }}
        keepBoardMounted={boardVisibility.held}
        onVisibilityActivityStart={boardVisibility.start}
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
    </div>
  );
}

interface StandupBodyProps {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly empty: boolean;
  readonly groups: readonly IssueGroup[];
  readonly filtered: boolean;
  readonly draggable: boolean;
  readonly groupBy: GroupByField;
  readonly reorderable: boolean;
  readonly properties: readonly DisplayProperty[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly resolveState: StateResolver;
  readonly onLoadMore: () => void;
  readonly keepBoardMounted: boolean;
  readonly onVisibilityActivityStart: () => () => void;
}

function StandupBody({
  loading,
  failed,
  onRetry,
  empty,
  groups,
  filtered,
  draggable,
  groupBy,
  reorderable,
  properties,
  hasMore,
  loadingMore,
  resolveState,
  onLoadMore,
  keepBoardMounted,
  onVisibilityActivityStart,
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

  if (failed) {
    return <LoadFailed subject="the standup board" onRetry={onRetry} testId="retry-standup" />;
  }

  if (empty && !keepBoardMounted) {
    return (
      <EmptyState
        icon={<SearchX strokeWidth={1.75} aria-hidden="true" />}
        title="Nothing on the board"
        description="Assign an issue or reviewer and it shows up here for everyone involved."
        className="flex-1"
      />
    );
  }

  return (
    <div className="min-h-0 flex-1" data-testid="standup-kanban">
      <Board
        groups={groups}
        filtered={filtered}
        draggable={draggable}
        groupBy={groupBy}
        reorderable={reorderable}
        properties={properties}
        hasMore={hasMore}
        loadingMore={loadingMore}
        resolveState={resolveState}
        onLoadMore={onLoadMore}
        onVisibilityActivityStart={onVisibilityActivityStart}
      />
    </div>
  );
}
