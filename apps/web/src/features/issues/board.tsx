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
import { useMemo, useState } from 'react';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { cn } from '@/lib/cn.ts';
import type { Issue } from '@/lib/query/schemas.ts';
import { type MoveInput, useMoveIssue } from '@/lib/query/use-issues.ts';
import { GroupGlyph } from './group-glyph.tsx';
import { IssueCard } from './issue-card.tsx';
import { useWorkspace } from './workspace-provider.tsx';

export interface BoardProps {
  readonly teamId: string;
  readonly groups: readonly IssueGroup[];
  readonly draggable?: boolean;
  readonly properties?: readonly DisplayProperty[];
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

function SortableCard({
  issue,
  properties,
}: {
  issue: Issue;
  properties: readonly DisplayProperty[];
}) {
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
      className={cn(
        'list-none',
        isDragging ? 'cursor-grabbing opacity-40' : 'cursor-grab active:cursor-grabbing',
      )}
      {...attributes}
      {...listeners}
    >
      <IssueCard
        issue={issue}
        properties={properties}
        labels={issue.labelIds.flatMap((id) => {
          const label = labelById.get(id);
          return label === undefined ? [] : [label];
        })}
        assignee={issue.assigneeId === null ? undefined : memberById.get(issue.assigneeId)}
      />
    </li>
  );
}

export function Board({
  teamId,
  groups,
  draggable = true,
  properties = DEFAULT_DISPLAY_PROPERTIES,
}: BoardProps) {
  const { labelById, memberById, openQuickCreate } = useWorkspace();
  const move = useMoveIssue(teamId);
  const [activeId, setActiveId] = useState<string | null>(null);

  const issues = useMemo(() => groups.flatMap((group) => [...group.issues]), [groups]);
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
          onCreate={() => openQuickCreate()}
        />
      ))}
    </div>
  );

  if (!draggable) return columns;

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
          <IssueCard
            issue={activeIssue}
            dragging
            properties={properties}
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

interface BoardColumnProps {
  readonly group: IssueGroup;
  readonly draggable: boolean;
  readonly properties: readonly DisplayProperty[];
  readonly onCreate: () => void;
}

function BoardColumn({ group, draggable, properties, onCreate }: BoardColumnProps) {
  const { setNodeRef } = useDroppable({ id: group.id, data: { isColumn: true } });

  const cards = group.issues.map((issue) =>
    draggable ? (
      <SortableCard key={issue.id} issue={issue} properties={properties} />
    ) : (
      <StaticCard key={issue.id} issue={issue} properties={properties} />
    ),
  );

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
          items={group.issues.map((issue) => issue.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul
            ref={setNodeRef}
            className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0"
          >
            {cards}
          </ul>
        </SortableContext>
      ) : (
        <ul className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">{cards}</ul>
      )}
    </section>
  );
}

function StaticCard({
  issue,
  properties,
}: {
  issue: Issue;
  properties: readonly DisplayProperty[];
}) {
  const { labelById, memberById } = useWorkspace();
  return (
    <li className="list-none">
      <IssueCard
        issue={issue}
        properties={properties}
        labels={issue.labelIds.flatMap((id) => {
          const label = labelById.get(id);
          return label === undefined ? [] : [label];
        })}
        assignee={issue.assigneeId === null ? undefined : memberById.get(issue.assigneeId)}
      />
    </li>
  );
}
