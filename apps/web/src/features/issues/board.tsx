'use client';

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
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
import type { DisplayProperty } from '@orbit/shared/filters';
import { DEFAULT_DISPLAY_PROPERTIES } from '@orbit/shared/filters';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { cn } from '@/lib/cn.ts';
import type { Cycle, Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import { type MoveInput, useMoveIssue } from '@/lib/query/use-issues.ts';
import { GroupGlyph } from './group-glyph.tsx';
import { IssueCard } from './issue-card.tsx';
import { IssuePeek } from './issue-peek.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface BoardProps {
  readonly teamId: string;
  readonly groups: readonly IssueGroup[];
  readonly draggable?: boolean;
  readonly properties?: readonly DisplayProperty[];
  readonly hasMore?: boolean;
  readonly loadingMore?: boolean;
  readonly onLoadMore?: (() => void) | undefined;
}

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

export function planDrop(
  groups: readonly IssueGroup[],
  issues: readonly Issue[],
  activeId: string,
  overId: string,
): MoveInput | null {
  const dragged = issues.find((issue) => issue.id === activeId);
  if (dragged === undefined || overId === activeId) return null;

  const targetGroup =
    groups.find((group) => group.id === overId) ??
    groups.find((group) => group.issues.some((issue) => issue.id === overId));
  if (targetGroup === undefined) return null;

  const siblings = targetGroup.issues.filter((issue) => issue.id !== dragged.id);
  const overIndex = siblings.findIndex((issue) => issue.id === overId);
  const insertAt = overIndex === -1 ? siblings.length : overIndex;
  const before = insertAt === 0 ? null : (siblings[insertAt - 1] ?? null);
  const after = siblings[insertAt] ?? null;

  return {
    issue: dragged,
    stateId: targetGroup.id,
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
    beforeOrder: before?.sortOrder ?? null,
    afterOrder: after?.sortOrder ?? null,
  };
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
        isDragging ? 'cursor-grabbing opacity-40' : 'cursor-grab active:cursor-grabbing',
      )}
      {...attributes}
      {...listeners}
    >
      <IssueCardView issue={issue} lookups={lookups} properties={properties} onOpen={onOpen} />
    </li>
  );
}

export function Board({
  teamId,
  groups,
  draggable = true,
  properties = DEFAULT_DISPLAY_PROPERTIES,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: BoardProps) {
  const { labelById, memberById, stateById, projects, cycles, openQuickCreate } = useWorkspace();
  const router = useRouter();
  const move = useMoveIssue(teamId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeIssue = issues.find((issue) => issue.id === activeId);
  const peekIssue = issues.find((issue) => issue.id === peekId);

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (event.over === null) return;
    const placement = planDrop(groups, issues, String(event.active.id), String(event.over.id));
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
          onCreate={() => openQuickCreate()}
          onOpen={setPeekId}
        />
      ))}
    </div>
  );

  const peek = (
    <IssuePeek
      issue={peekIssue}
      onClose={() => setPeekId(null)}
      onOpen={() => {
        if (peekIssue !== undefined) router.push(`/issue/${peekIssue.identifier}`);
      }}
    />
  );

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
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {columns}

      <DragOverlay dropAnimation={{ duration: 140, easing: 'cubic-bezier(0.22,0.61,0.36,1)' }}>
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
  readonly onCreate: () => void;
  readonly onOpen: (id: string) => void;
}

function BoardColumn({
  group,
  draggable,
  properties,
  lookups,
  hasMore,
  loadingMore,
  onLoadMore,
  onCreate,
  onOpen,
}: BoardColumnProps) {
  const { setNodeRef } = useDroppable({ id: group.id, data: { isColumn: true } });
  const scrollRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const scrolledRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const total = group.issues.length;
  const hasHiddenLocal = visibleCount < total;
  const visibleIssues = useMemo(
    () => group.issues.slice(0, visibleCount),
    [group.issues, visibleCount],
  );

  const canFetchMore = hasMore && onLoadMore !== undefined;
  const wantsSentinel = hasHiddenLocal || canFetchMore;

  useEffect(() => {
    const node = sentinelRef.current;
    const root = scrollRef.current;
    if (node === null || root === null || !wantsSentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (hasHiddenLocal) {
          setVisibleCount((count) => Math.min(count + VISIBLE_STEP, total));
        } else if (scrolledRef.current && canFetchMore) {
          onLoadMore?.();
        }
      },
      { root, rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [wantsSentinel, hasHiddenLocal, canFetchMore, total, onLoadMore]);

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
      {loadingMore && !hasHiddenLocal ? (
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
          {group.issues.length}
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
