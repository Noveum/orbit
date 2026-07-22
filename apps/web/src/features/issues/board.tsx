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
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn.ts';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { sortIssues } from '@/lib/query/sync.ts';
import { type MoveInput, useMoveIssue } from '@/lib/query/use-issues.ts';
import { IssueCard } from './issue-card.tsx';
import { StateGlyph } from './state-glyph.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface BoardProps {
  readonly teamId: string;
  readonly states: readonly WorkflowState[];
  readonly issues: readonly Issue[];
}

export interface Column {
  readonly state: WorkflowState;
  readonly issues: readonly Issue[];
}

export function buildColumns(states: readonly WorkflowState[], issues: readonly Issue[]): Column[] {
  const byState = new Map<string, Issue[]>();
  for (const issue of issues) {
    const bucket = byState.get(issue.stateId) ?? [];
    bucket.push(issue);
    byState.set(issue.stateId, bucket);
  }
  return states.map((state) => ({
    state,
    issues: sortIssues(byState.get(state.id) ?? []),
  }));
}

export function planDrop(
  columns: readonly Column[],
  issues: readonly Issue[],
  activeId: string,
  overId: string,
): MoveInput | null {
  const dragged = issues.find((issue) => issue.id === activeId);
  if (dragged === undefined || overId === activeId) return null;

  const targetColumn =
    columns.find((column) => column.state.id === overId) ??
    columns.find((column) => column.issues.some((issue) => issue.id === overId));
  if (targetColumn === undefined) return null;

  const siblings = targetColumn.issues.filter((issue) => issue.id !== dragged.id);
  const overIndex = siblings.findIndex((issue) => issue.id === overId);
  const insertAt = overIndex === -1 ? siblings.length : overIndex;
  const before = insertAt === 0 ? null : (siblings[insertAt - 1] ?? null);
  const after = siblings[insertAt] ?? null;

  return {
    issue: dragged,
    stateId: targetColumn.state.id,
    beforeId: before?.id ?? null,
    afterId: after?.id ?? null,
    beforeOrder: before?.sortOrder ?? null,
    afterOrder: after?.sortOrder ?? null,
  };
}

function SortableCard({ issue }: { issue: Issue }) {
  const { labelById, memberById } = useWorkspace();
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
      className={cn('list-none', isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
    >
      <IssueCard
        issue={issue}
        labels={issue.labelIds.flatMap((id) => {
          const label = labelById.get(id);
          return label === undefined ? [] : [label];
        })}
        assignee={issue.assigneeId === null ? undefined : memberById.get(issue.assigneeId)}
      />
    </li>
  );
}

export function Board({ teamId, states, issues }: BoardProps) {
  const { labelById, memberById, openQuickCreate } = useWorkspace();
  const move = useMoveIssue(teamId);
  const [activeId, setActiveId] = useState<string | null>(null);

  const columns = useMemo(() => buildColumns(states, issues), [states, issues]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeIssue = issues.find((issue) => issue.id === activeId);

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (event.over === null) return;
    const placement = planDrop(columns, issues, String(event.active.id), String(event.over.id));
    if (placement !== null) move.mutate(placement);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-3">
        {columns.map((column) => (
          <BoardColumn key={column.state.id} column={column} onCreate={() => openQuickCreate()} />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 140, easing: 'cubic-bezier(0.22,0.61,0.36,1)' }}>
        {activeIssue === undefined ? null : (
          <IssueCard
            issue={activeIssue}
            dragging
            labels={activeIssue.labelIds.flatMap((id) => {
              const label = labelById.get(id);
              return label === undefined ? [] : [label];
            })}
            assignee={
              activeIssue.assigneeId === null ? undefined : memberById.get(activeIssue.assigneeId)
            }
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({ column, onCreate }: { column: Column; onCreate: () => void }) {
  const { setNodeRef } = useDroppable({ id: column.state.id, data: { isColumn: true } });

  return (
    <section
      data-testid={`board-column-${column.state.name}`}
      className="flex w-72 shrink-0 flex-col rounded-lg bg-surface-2/60"
    >
      <header className="flex items-center gap-2 px-2.5 py-2">
        <StateGlyph category={column.state.category} color={column.state.color} />
        <h2 className="font-medium text-dense text-text">{column.state.name}</h2>
        <span data-numeric className="text-2xs text-faint">
          {column.issues.length}
        </span>
        <button
          type="button"
          onClick={onCreate}
          aria-label={`Create an issue in ${column.state.name}`}
          className="ml-auto rounded-sm p-1 text-faint transition-colors duration-[var(--duration-fast)] hover:bg-surface-3 hover:text-text"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      <SortableContext
        items={column.issues.map((issue) => issue.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          ref={setNodeRef}
          className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0"
        >
          {column.issues.map((issue) => (
            <SortableCard key={issue.id} issue={issue} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}
