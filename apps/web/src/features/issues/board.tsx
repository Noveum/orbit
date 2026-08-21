'use client';

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { OrgRole } from '@orbit/shared/constants';
import type { DisplayOptions, DisplayProperty, GroupByField } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES, emptyFilterGroup } from '@orbit/shared/filters';
import { permissionsFor } from '@orbit/shared/policy';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyDisplayFilters, displayFiltersHideRows } from '@/features/filters/display-filter.ts';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { UNGROUPED_ID } from '@/features/filters/grouping.ts';
import { cn } from '@/lib/cn.ts';
import type { Cycle, Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import type { IssueQuery, IssueRegrouping, MoveInput } from '@/lib/query/use-issues.ts';
import { useBoardPage, useColumnIssues, useMoveIssue } from '@/lib/query/use-issues.ts';
import { GroupGlyph } from './group-glyph.tsx';
import { IssueCard } from './issue-card.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { useBoardAutoScroll } from './use-board-autoscroll.ts';
import { useWorkspace } from './workspace-provider.tsx';

export interface BoardColumnSource {
  readonly query: IssueQuery;
  readonly groupBy: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly display: DisplayOptions;
}

export type StateResolver = (groupId: string, issue: Issue) => string | null;

export interface BoardProps {
  readonly groups: readonly IssueGroup[];
  readonly draggable?: boolean;
  readonly reorderable?: boolean;
  readonly resolveState?: StateResolver | undefined;
  readonly properties?: readonly DisplayProperty[];
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly onLoadMore?: (() => void) | undefined;
  readonly columnSource?: BoardColumnSource | undefined;
  readonly groupBy?: GroupByField;
}

const EMPTY_QUERY: IssueQuery = { filter: emptyFilterGroup(), orderBy: 'manual' };

const EMPTY_COLUMN = {
  query: EMPTY_QUERY,
  groupBy: 'state',
  scope: {} as Readonly<Record<string, string>>,
};

export function columnsReadyFor(columnSource: object | undefined, boardPending: boolean): boolean {
  return columnSource === undefined || !boardPending;
}

export const boardCollision: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  return under.length > 0 ? under : rectIntersection(args);
};

const INITIAL_VISIBLE = 15;
const VISIBLE_STEP = 15;

interface CardLookups {
  readonly labelById: ReadonlyMap<string, Label>;
  readonly memberById: ReadonlyMap<string, Member>;
  readonly stateById: ReadonlyMap<string, WorkflowState>;
  readonly projectById: ReadonlyMap<string, Project>;
  readonly cycleById: ReadonlyMap<string, Cycle>;
  readonly childCounts: ReadonlyMap<string, number>;
}

export const REGROUPABLE_FIELDS: readonly GroupByField[] = [
  'state',
  'cycle',
  'project',
  'assignee',
  'priority',
];

export function canRegroup(groupBy: GroupByField): boolean {
  return REGROUPABLE_FIELDS.includes(groupBy);
}

export function canDragBoard(role: OrgRole, groupBy: GroupByField): boolean {
  return canRegroup(groupBy) && permissionsFor(role).includes('issue:update');
}

export function regroupPatch(groupBy: GroupByField, groupId: string): IssueRegrouping | null {
  const id = groupId === UNGROUPED_ID ? null : groupId;
  switch (groupBy) {
    case 'state':
      return id === null ? null : { stateId: id };
    case 'cycle':
      return { cycleId: id };
    case 'project':
      return { projectId: id };
    case 'assignee':
      return { assigneeId: id };
    case 'priority': {
      const priority = Number(groupId);
      return Number.isInteger(priority) && priority >= 0 && priority <= 4 ? { priority } : null;
    }
    default:
      return null;
  }
}

function targetGroupFor(groups: readonly IssueGroup[], overId: string): IssueGroup | undefined {
  return (
    groups.find((group) => group.id === overId) ??
    groups.find((group) => group.issues.some((issue) => issue.id === overId))
  );
}

function neighboursIn(
  group: IssueGroup,
  dragged: Issue,
  overId: string,
): { before: Issue | null; after: Issue | null } {
  const siblings = group.issues.filter((issue) => issue.id !== dragged.id);
  const overIndex = siblings.findIndex((issue) => issue.id === overId);
  const insertAt = overIndex === -1 ? siblings.length : overIndex;
  return {
    before: insertAt === 0 ? null : (siblings[insertAt - 1] ?? null),
    after: siblings[insertAt] ?? null,
  };
}

export function planDrop(
  groups: readonly IssueGroup[],
  issues: readonly Issue[],
  activeId: string,
  overId: string,
  groupBy: GroupByField,
  resolveState?: StateResolver | undefined,
  reorderable = true,
): MoveInput | null {
  const dragged = issues.find((issue) => issue.id === activeId);
  if (dragged === undefined || overId === activeId) return null;

  const targetGroup = targetGroupFor(groups, overId);
  if (targetGroup === undefined) return null;

  const groupId =
    groupBy === 'state' && resolveState !== undefined
      ? resolveState(targetGroup.id, dragged)
      : targetGroup.id;
  if (groupId === null) return null;

  const regrouping = regroupPatch(groupBy, groupId);
  if (regrouping === null) return null;

  if (!reorderable) {
    if (regroupingLeavesIssue(regrouping, dragged)) return null;
    return {
      issue: dragged,
      ...regrouping,
      beforeId: null,
      afterId: null,
      beforeOrder: null,
      afterOrder: null,
    };
  }

  const { before, after } = neighboursIn(targetGroup, dragged, overId);

  return {
    issue: dragged,
    ...regrouping,
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
    beforeOrder: before?.sortOrder ?? null,
    afterOrder: after?.sortOrder ?? null,
  };
}

export function regroupingLeavesIssue(regrouping: IssueRegrouping, issue: Issue): boolean {
  const entries = Object.entries(regrouping) as [keyof IssueRegrouping, unknown][];
  return entries.every(([field, value]) => issue[field as keyof Issue] === value);
}

function IssueCardView({
  issue,
  lookups,
  properties,
  dragging = false,
  onOpen,
}: {
  issue: Issue;
  lookups: CardLookups;
  properties: readonly DisplayProperty[];
  dragging?: boolean;
  onOpen?: (id: string) => void;
}) {
  return (
    <IssueCard
      issue={issue}
      dragging={dragging}
      properties={properties}
      labels={issue.labelIds.flatMap((id) => {
        const label = lookups.labelById.get(id);
        return label === undefined ? [] : [label];
      })}
      assignee={issue.assigneeId === null ? undefined : lookups.memberById.get(issue.assigneeId)}
      reviewers={(issue.reviewerIds ?? []).flatMap((id) => {
        const reviewer = lookups.memberById.get(id);
        return reviewer === undefined ? [] : [reviewer];
      })}
      state={lookups.stateById.get(issue.stateId)}
      creator={lookups.memberById.get(issue.creatorId)}
      project={issue.projectId === null ? undefined : lookups.projectById.get(issue.projectId)}
      cycle={issue.cycleId === null ? undefined : lookups.cycleById.get(issue.cycleId)}
      subIssueCount={lookups.childCounts.get(issue.id) ?? 0}
      {...(onOpen === undefined ? {} : { onOpen })}
    />
  );
}

function SortableCard({
  issue,
  lookups,
  properties,
  onOpen,
}: {
  issue: Issue;
  lookups: CardLookups;
  properties: readonly DisplayProperty[];
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
    data: { stateId: issue.stateId },
  });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? 'transform 140ms var(--ease-out-orbit)',
      }}
      className={cn(
        'list-none',
        isDragging
          ? 'cursor-grabbing rounded-lg border border-accent border-dashed bg-accent-soft/40 opacity-100 [&>*]:invisible'
          : 'cursor-grab active:cursor-grabbing',
      )}
      {...attributes}
      {...listeners}
    >
      <IssueCardView issue={issue} lookups={lookups} properties={properties} onOpen={onOpen} />
    </li>
  );
}

export function Board({
  groups,
  draggable = true,
  reorderable = true,
  properties = DEFAULT_DISPLAY_PROPERTIES,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  columnSource,
  groupBy = 'state',
  resolveState,
}: BoardProps) {
  const { labelById, memberById, stateById, projects, cycles, openQuickCreate } = useWorkspace();
  const move = useMoveIssue();
  const boardPage = useBoardPage(columnSource ?? EMPTY_COLUMN, columnSource !== undefined);
  const columnsReady = columnsReadyFor(columnSource, boardPage.isPending);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  const columnRows = useRef<Map<string, readonly Issue[]>>(new Map());
  const publishRows = useCallback((groupId: string, rows: readonly Issue[]) => {
    columnRows.current.set(groupId, rows);
  }, []);

  const loadedGroups = useCallback(
    () =>
      groups.map((group) => {
        const rows = columnRows.current.get(group.id);
        return rows === undefined || rows === group.issues ? group : { ...group, issues: rows };
      }),
    [groups],
  );

  const issuesInPlay = useCallback(
    () => loadedGroups().flatMap((group) => [...group.issues]),
    [loadedGroups],
  );

  const issues = useMemo(() => groups.flatMap((group) => [...group.issues]), [groups]);
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const cycleById = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle])), [cycles]);
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.parentId === null) continue;
      counts.set(issue.parentId, (counts.get(issue.parentId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);
  const lookups = useMemo<CardLookups>(
    () => ({ labelById, memberById, stateById, projectById, cycleById, childCounts }),
    [labelById, memberById, stateById, projectById, cycleById, childCounts],
  );

  useBoardAutoScroll(activeId !== null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dragged = useRef<Issue | undefined>(undefined);
  const peekIssue =
    peekId === null ? undefined : issuesInPlay().find((issue) => issue.id === peekId);
  const activeIssue = activeId === null ? undefined : dragged.current;

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    dragged.current = issuesInPlay().find((issue) => issue.id === id);
    setActiveId(id);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (event.over === null) return;
    const placement = planDrop(
      loadedGroups(),
      issuesInPlay(),
      String(event.active.id),
      String(event.over.id),
      groupBy,
      resolveState,
      reorderable,
    );
    if (placement !== null) move.mutate(placement);
  };

  const columns = (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-3">
      {groups.map((group) => (
        <BoardColumn
          key={group.id}
          group={group}
          draggable={draggable}
          properties={properties}
          lookups={lookups}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          columnSource={columnSource}
          columnsReady={columnsReady}
          onCreate={() => openQuickCreate()}
          onOpen={setPeekId}
          onRows={publishRows}
        />
      ))}
    </div>
  );

  const peek = <IssuePeek issueId={peekId} issue={peekIssue} onClose={() => setPeekId(null)} />;

  if (!draggable) {
    return (
      <>
        {columns}
        {peek}
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {columns}

      <DragOverlay dropAnimation={null}>
        {activeIssue === undefined ? null : (
          <IssueCardView issue={activeIssue} lookups={lookups} properties={properties} dragging />
        )}
      </DragOverlay>

      {peek}
    </DndContext>
  );
}

interface BoardColumnProps {
  readonly group: IssueGroup;
  readonly draggable: boolean;
  readonly properties: readonly DisplayProperty[];
  readonly lookups: CardLookups;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly onLoadMore: (() => void) | undefined;
  readonly columnSource: BoardColumnSource | undefined;
  readonly columnsReady: boolean;
  readonly onCreate: () => void;
  readonly onOpen: (id: string) => void;
  readonly onRows: (groupId: string, issues: readonly Issue[]) => void;
}

function BoardColumn({
  group,
  draggable,
  properties,
  lookups,
  hasMore,
  loadingMore,
  onLoadMore,
  columnSource,
  columnsReady,
  onCreate,
  onOpen,
  onRows,
}: BoardColumnProps) {
  const { stateById } = useWorkspace();
  const owned = useColumnIssues(
    columnSource ?? EMPTY_COLUMN,
    group.id,
    columnSource !== undefined && columnsReady,
  );
  const ownsData = columnSource !== undefined;
  const fetched = owned.data ?? group.issues;
  const issues = useMemo(
    () =>
      ownsData && columnSource !== undefined
        ? applyDisplayFilters(fetched, columnSource.display, stateById).issues
        : group.issues,
    [ownsData, columnSource, fetched, group.issues, stateById],
  );

  useEffect(() => {
    onRows(group.id, issues);
  }, [onRows, group.id, issues]);
  const columnHasMore = ownsData ? owned.hasNextPage : hasMore;
  const columnLoadingMore = ownsData ? owned.isFetchingNextPage : loadingMore;
  const loadMore = ownsData
    ? () => {
        owned.fetchNextPage().catch(() => undefined);
      }
    : onLoadMore;

  const trimmed =
    columnSource !== undefined &&
    displayFiltersHideRows(columnSource.display) &&
    !owned.hasNextPage;

  const { setNodeRef } = useDroppable({ id: group.id, data: { isColumn: true } });
  const scrollRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const scrolledRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const loaded = issues.length;
  const hasHiddenLocal = visibleCount < loaded;
  const visibleIssues = useMemo(() => issues.slice(0, visibleCount), [issues, visibleCount]);

  const canFetchMore = columnHasMore && loadMore !== undefined;
  const wantsSentinel = hasHiddenLocal || canFetchMore;

  useEffect(() => {
    const node = sentinelRef.current;
    const root = scrollRef.current;
    if (node === null || root === null || !wantsSentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (hasHiddenLocal) {
          setVisibleCount((count) => Math.min(count + VISIBLE_STEP, loaded));
          return;
        }
        if (!canFetchMore || columnLoadingMore) return;
        const laidOut = root.scrollHeight > 0;
        const fits = laidOut && root.scrollHeight <= root.clientHeight;
        if (scrolledRef.current || fits) loadMore?.();
      },
      { root, rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [wantsSentinel, hasHiddenLocal, canFetchMore, columnLoadingMore, loaded, loadMore]);

  const markScrolled = useCallback(() => {
    scrolledRef.current = true;
  }, []);

  const setScrollNode = useCallback(
    (node: HTMLUListElement | null) => {
      scrollRef.current = node;
      if (draggable) setNodeRef(node);
    },
    [draggable, setNodeRef],
  );

  const cards = visibleIssues.map((issue) =>
    draggable ? (
      <SortableCard
        key={issue.id}
        issue={issue}
        lookups={lookups}
        properties={properties}
        onOpen={onOpen}
      />
    ) : (
      <li key={issue.id} className="list-none">
        <IssueCardView issue={issue} lookups={lookups} properties={properties} onOpen={onOpen} />
      </li>
    ),
  );

  const footer = (
    <>
      {columnLoadingMore && !hasHiddenLocal ? (
        <li className="h-[4.75rem] shrink-0 animate-pulse list-none rounded-lg bg-surface-3/50" />
      ) : null}
      {wantsSentinel ? (
        <li ref={sentinelRef} className="h-px shrink-0 list-none" aria-hidden="true" />
      ) : null}
    </>
  );

  const listClass = 'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0';

  return (
    <section
      data-testid={`board-column-${group.title}`}
      className="group flex w-72 shrink-0 flex-col rounded-lg bg-surface-2/60"
    >
      <header className="flex items-center gap-2 px-2.5 py-2">
        <GroupGlyph group={group} />
        <h2 className="font-medium text-dense text-text">{group.title}</h2>
        <span data-numeric className="text-2xs text-faint">
          {trimmed ? issues.length : group.total}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={`Create an issue in ${group.title}`}
          className={cn(
            'ml-auto rounded-sm p-1 text-faint opacity-0',
            'transition-[opacity,background-color,color] duration-[var(--duration-fast)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            'group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-text',
            '[@media(hover:none)]:opacity-100',
          )}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      {draggable ? (
        <SortableContext
          items={visibleIssues.map((issue) => issue.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul ref={setScrollNode} onScroll={markScrolled} className={listClass}>
            {cards}
            {footer}
          </ul>
        </SortableContext>
      ) : (
        <ul ref={scrollRef} onScroll={markScrolled} className={listClass}>
          {cards}
          {footer}
        </ul>
      )}
    </section>
  );
}
