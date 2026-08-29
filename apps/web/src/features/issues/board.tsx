'use client';

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
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
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyDisplayFilters, displayFiltersHideRows } from '@/features/filters/display-filter.ts';
import type { IssueGroup } from '@/features/filters/grouping.ts';
import { UNGROUPED_ID } from '@/features/filters/grouping.ts';
import type { ViewConfig } from '@/features/filters/view-config.ts';
import { cn } from '@/lib/cn.ts';
import { issueDeletionGeneration } from '@/lib/query/issue-cache-generation.ts';
import type { Cycle, Issue, Label, Member, Project, WorkflowState } from '@/lib/query/schemas.ts';
import type {
  AuthoritativeCachedIssue,
  IssueMoveSettlement,
  IssueQuery,
  IssueRegrouping,
  MoveInput,
} from '@/lib/query/use-issues.ts';
import {
  authoritativeCachedIssue,
  useBoardPage,
  useColumnIssues,
  useMoveIssue,
} from '@/lib/query/use-issues.ts';
import { createBoardSensorController } from './board-sensors.ts';
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
  readonly filtered?: boolean;
  readonly onVisibilityActivityStart?: () => () => void;
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

export interface BoardPosition {
  readonly column: string;
  readonly position: number;
  readonly total?: number;
}

export interface BoardDestination {
  readonly column: string;
  readonly position?: number;
  readonly total?: number;
}

export interface BoardSource extends BoardPosition {
  readonly groupId: string;
}

export interface BoardTarget extends BoardDestination {
  readonly groupId: string;
}

export interface CompletedDrag {
  readonly session: number;
  readonly identifier: string;
  readonly source: BoardSource;
  readonly destination: BoardTarget;
}

export interface SettledDragStatusInput {
  readonly latestSession: number;
  readonly activeSession: number | null;
  readonly completed: CompletedDrag;
  readonly outcome: 'success' | 'error';
  readonly settledPosition: BoardPosition | null;
}

export interface CompletedDragResult extends SettledDragStatusInput {
  readonly superseded: boolean;
  readonly deleted?: boolean;
}

export interface CompletedDragResultOutput {
  readonly status: string | null;
  readonly focusGroupId: string | null;
}

interface CurrentCompletedDragResultInput {
  readonly queryClient: QueryClient;
  readonly dragId: string;
  readonly deletionGeneration: number;
  readonly settlement: IssueMoveSettlement | undefined;
  readonly outcome: SettledDragStatusInput['outcome'];
  readonly settled: Issue | undefined;
  readonly completed: CompletedDrag;
  readonly filtered: boolean;
  readonly latestSession: number;
  readonly activeSession: number | null;
  readonly cardNodes: ReadonlyMap<string, HTMLLIElement>;
  readonly columnNodes: ReadonlyMap<string, HTMLUListElement>;
}

export function settledDragStatus(input: SettledDragStatusInput): string | null {
  const { latestSession, activeSession, completed, outcome, settledPosition } = input;
  if (completed.session !== latestSession || activeSession !== null) return null;
  if (outcome === 'error') {
    const returned = settledPosition ?? { column: completed.source.column };
    return `Failed to move ${completed.identifier}. Returned to ${boardPositionLabel(returned)}.`;
  }
  const destination = settledPosition ?? { column: completed.destination.column };
  return `Moved ${completed.identifier} from ${boardPositionLabel(completed.source)} to ${boardPositionLabel(destination)}.`;
}

export function completedDragResult(input: CompletedDragResult): CompletedDragResultOutput {
  const status = settledDragStatus(input);
  if (status === null) return { status: null, focusGroupId: null };
  if (input.deleted === true) {
    return {
      status: `${input.completed.identifier} was deleted while the move finished.`,
      focusGroupId:
        input.outcome === 'success'
          ? input.completed.destination.groupId
          : input.completed.source.groupId,
    };
  }
  if (input.superseded) {
    return {
      status: `${input.completed.identifier} changed again while the move finished. Showing the latest version.`,
      focusGroupId: null,
    };
  }
  return {
    status,
    focusGroupId:
      input.outcome === 'success'
        ? input.completed.destination.groupId
        : input.completed.source.groupId,
  };
}

function currentCompletedDragResult(
  input: CurrentCompletedDragResultInput,
): CompletedDragResultOutput {
  const endpoint =
    input.outcome === 'success' ? input.completed.destination : input.completed.source;
  const deleted =
    input.settlement?.issueWasDeletedDuringSettlement === true ||
    issueDeletionGeneration(input.queryClient, input.dragId) !== input.deletionGeneration;
  const settledPosition = input.filtered
    ? null
    : registeredBoardPosition(input.dragId, endpoint, input.cardNodes, input.columnNodes);
  const cached = authoritativeCachedIssue(input.queryClient, input.dragId);
  return completedDragResult({
    latestSession: input.latestSession,
    activeSession: input.activeSession,
    completed: input.completed,
    outcome: input.outcome,
    settledPosition,
    superseded: moveResultWasSuperseded(cached, input.settled, input.outcome, deleted),
    deleted,
  });
}

export function moveResultWasSuperseded(
  cached: AuthoritativeCachedIssue,
  settled: Issue | undefined,
  outcome: SettledDragStatusInput['outcome'],
  issueWasDeletedDuringSettlement = false,
): boolean {
  if (settled === undefined) return true;
  if (cached.kind === 'missing') {
    return outcome !== 'success' || issueWasDeletedDuringSettlement;
  }
  if (cached.kind !== 'found') return true;
  const current = cached.issue;
  return (
    current.syncId !== settled.syncId ||
    current.stateId !== settled.stateId ||
    current.cycleId !== settled.cycleId ||
    current.projectId !== settled.projectId ||
    current.assigneeId !== settled.assigneeId ||
    current.priority !== settled.priority ||
    current.sortOrder !== settled.sortOrder
  );
}

export function focusRemainsBoardOwned(
  focused: Element | null,
  body: HTMLElement,
  ownedCard: Element | undefined,
  ownedColumn: Element | undefined,
  alternateOwnedColumn?: Element | undefined,
): boolean {
  return (
    focused === body ||
    focused === ownedCard ||
    focused === ownedColumn ||
    focused === alternateOwnedColumn
  );
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

export function boardPositionsAreIncomplete(
  filtered: boolean,
  display: DisplayOptions | undefined,
): boolean {
  return filtered || (display !== undefined && displayFiltersHideRows(display));
}

export function boardVisibilityConfig(config: ViewConfig) {
  return {
    filter: config.filter,
    groupBy: config.groupBy,
    subGroupBy: config.subGroupBy,
    orderBy: config.orderBy,
    display: {
      showSubIssues: config.display.showSubIssues,
      showEmptyGroups: config.display.showEmptyGroups,
      showCompleted: config.display.showCompleted,
    },
  };
}

interface BoardVisibilityActivity {
  readonly generation: number;
  readonly count: number;
  readonly latched: boolean;
}

export function useBoardVisibilityHold(contextKey: string, empty: boolean) {
  const context = useRef({ key: contextKey, generation: 0 });
  if (context.current.key !== contextKey) {
    context.current = { key: contextKey, generation: context.current.generation + 1 };
  }
  const generation = context.current.generation;
  const latestEmpty = useRef(empty);
  latestEmpty.current = empty;
  const [activity, setActivity] = useState<BoardVisibilityActivity>({
    generation,
    count: 0,
    latched: false,
  });
  useLayoutEffect(() => {
    if (empty) return;
    setActivity((current) =>
      current.generation === generation && current.latched
        ? { ...current, latched: false }
        : current,
    );
  }, [empty, generation]);
  const start = useCallback(() => {
    let ended = false;
    setActivity((current) => ({
      generation,
      count: current.generation === generation ? current.count + 1 : 1,
      latched: current.generation === generation && current.latched,
    }));
    return () => {
      if (ended) return;
      ended = true;
      setActivity((current) => {
        if (current.generation !== generation || current.count === 0) return current;
        const count = current.count - 1;
        return {
          generation,
          count,
          latched: current.latched || (count === 0 && latestEmpty.current),
        };
      });
    };
  }, [generation]);
  const current = activity.generation === generation ? activity : undefined;
  return {
    key: `${generation}:${contextKey}`,
    held: current !== undefined && (current.count > 0 || current.latched),
    start,
  };
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
  const insertAt = dropIndexFor(group, dragged.id, overId);
  return {
    before: insertAt === 0 ? null : (siblings[insertAt - 1] ?? null),
    after: siblings[insertAt] ?? null,
  };
}

function dropIndexFor(group: IssueGroup, activeId: string, overId: string): number {
  const activeIndex = group.issues.findIndex((issue) => issue.id === activeId);
  const targetIndex = group.issues.findIndex((issue) => issue.id === overId);
  const siblings = group.issues.filter((issue) => issue.id !== activeId);
  const targetWithoutActive = siblings.findIndex((issue) => issue.id === overId);
  if (targetWithoutActive === -1) return siblings.length;
  const movingDown = activeIndex !== -1 && targetIndex !== -1 && activeIndex < targetIndex;
  return targetWithoutActive + (movingDown ? 1 : 0);
}

export function dropPositionFor(
  groups: readonly IssueGroup[],
  activeId: string,
  overId: string,
): BoardPosition | null {
  const overGroup = targetGroupFor(groups, overId);
  if (overGroup === undefined) return null;
  const siblings = overGroup.issues.filter((i) => i.id !== activeId);
  const position = dropIndexFor(overGroup, activeId, overId) + 1;
  const complete = overGroup.issues.length === overGroup.total;
  return {
    column: overGroup.title,
    position,
    ...(complete ? { total: siblings.length + 1 } : {}),
  };
}

function currentSourceFor(groups: readonly IssueGroup[], issueId: string): BoardSource | null {
  const group = groups.find((entry) => entry.issues.some((issue) => issue.id === issueId));
  if (group === undefined) return null;
  const position = positionInGroup(group, issueId);
  return position === null ? null : { ...position, groupId: group.id };
}

function newestIssueFor(groups: readonly IssueGroup[], issueId: string): Issue | undefined {
  let newest: Issue | undefined;
  for (const group of groups) {
    for (const issue of group.issues) {
      if (issue.id !== issueId) continue;
      if (newest === undefined || issue.syncId > newest.syncId) newest = issue;
    }
  }
  return newest;
}

export type DragSourceSnapshot =
  | { readonly kind: 'missing' }
  | { readonly kind: 'pending'; readonly issue: Issue }
  | { readonly kind: 'ambiguous'; readonly issue: Issue }
  | { readonly kind: 'found'; readonly issue: Issue; readonly source: BoardSource };

function issueBoardFingerprint(issue: Issue): string {
  return (
    JSON.stringify([
      issue.id,
      issue.teamId,
      issue.stateId,
      issue.priority,
      issue.assigneeId,
      issue.projectId,
      issue.cycleId,
      issue.sortOrder,
      issue.syncId,
    ]) ?? ''
  );
}

export function dragSourceSnapshotFor(
  groups: readonly IssueGroup[],
  issueId: string,
  groupBy: GroupByField,
  resolveState: StateResolver | undefined,
): DragSourceSnapshot {
  const occurrences = groups.flatMap((group) =>
    group.issues.flatMap((issue) => (issue.id === issueId ? [{ group, issue }] : [])),
  );
  const newestSyncId = occurrences.reduce(
    (newest, occurrence) => Math.max(newest, occurrence.issue.syncId),
    Number.NEGATIVE_INFINITY,
  );
  const newest = occurrences.filter((occurrence) => occurrence.issue.syncId === newestSyncId);
  const issue = newest[0]?.issue;
  if (issue === undefined) return { kind: 'missing' };
  const fingerprint = issueBoardFingerprint(issue);
  if (newest.some((occurrence) => issueBoardFingerprint(occurrence.issue) !== fingerprint)) {
    return { kind: 'ambiguous', issue };
  }

  let found: { readonly issue: Issue; readonly source: BoardSource } | undefined;
  for (const occurrence of newest) {
    if (!groupMatchesIssue(occurrence.group, occurrence.issue, groupBy, resolveState)) continue;
    const position = positionInGroup(occurrence.group, issueId);
    if (position === null) continue;
    const source = { ...position, groupId: occurrence.group.id };
    if (found === undefined) {
      found = { issue: occurrence.issue, source };
      continue;
    }
    if (found.source.groupId !== source.groupId) return { kind: 'ambiguous', issue };
  }
  return found === undefined ? { kind: 'pending', issue } : { kind: 'found', ...found };
}

function positionInGroup(group: IssueGroup, issueId: string): BoardPosition | null {
  const index = group.issues.findIndex((issue) => issue.id === issueId);
  if (index === -1) return null;
  return {
    column: group.title,
    position: index + 1,
    ...(group.issues.length === group.total ? { total: group.total } : {}),
  };
}

function groupMatchesIssue(
  group: IssueGroup,
  issue: Issue,
  groupBy: GroupByField,
  resolveState: StateResolver | undefined,
): boolean {
  const groupId =
    groupBy === 'state' && resolveState !== undefined ? resolveState(group.id, issue) : group.id;
  if (groupId === null) return false;
  const regrouping = regroupPatch(groupBy, groupId);
  return regrouping !== null && regroupingLeavesIssue(regrouping, issue);
}

function boardPositionLabel(position: BoardDestination): string {
  if (position.position === undefined) return `column ${position.column}`;
  const total = position.total === undefined ? '' : ` of ${position.total}`;
  return `column ${position.column}, position ${position.position}${total}`;
}

export function registeredBoardPosition(
  issueId: string,
  target: BoardSource | BoardTarget,
  cardNodes: ReadonlyMap<string, HTMLLIElement>,
  columnNodes: ReadonlyMap<string, HTMLUListElement>,
): BoardPosition | null {
  const card = cardNodes.get(issueId);
  const column = columnNodes.get(target.groupId);
  if (card === undefined || column === undefined || !column.contains(card)) return null;
  const cards = Array.from(column.querySelectorAll('li[tabindex]'));
  const index = cards.indexOf(card);
  if (index === -1) return null;
  const incomplete = Array.from(column.children).some((child) =>
    child.matches('li[aria-hidden="true"]'),
  );
  return {
    column: target.column,
    position: index + 1,
    ...(incomplete ? {} : { total: cards.length }),
  };
}

function getAdjacentColumnCard(
  columns: Element[],
  targetColIndex: number,
  currentCardIndex: number,
): HTMLElement | null {
  const col = columns[targetColIndex];
  if (col === undefined) return null;
  const cards = Array.from(col.querySelectorAll('li[tabindex]'));
  if (cards.length === 0) return col.querySelector('ul');
  const safeIndex = Math.max(0, Math.min(currentCardIndex, cards.length - 1));
  return (cards[safeIndex] ?? null) as HTMLElement | null;
}

function getDOMIndices(
  currentFocus: Element,
  board: HTMLElement,
): {
  cols: Element[];
  colIndex: number;
  cardsInCol: Element[];
  cardIndex: number;
} | null {
  if (!board.contains(currentFocus)) return null;
  const currentCol = currentFocus.closest('[data-testid^="board-column-"]');
  if (currentCol === null || !board.contains(currentCol)) return null;
  const cols = Array.from(board.querySelectorAll('[data-testid^="board-column-"]'));
  const cardsInCol = Array.from(currentCol.querySelectorAll('li[tabindex]'));
  const cardIndex = cardsInCol.indexOf(currentFocus);
  const columnNode = currentCol.querySelector('ul');
  if (cardIndex === -1 && currentFocus !== columnNode) return null;
  return {
    cols,
    colIndex: cols.indexOf(currentCol),
    cardsInCol,
    cardIndex,
  };
}

function getNextCardTarget(
  key: string,
  cols: Element[],
  colIndex: number,
  cardsInCol: Element[],
  cardIndex: number,
): HTMLElement | null {
  if (key === 'ArrowDown') return (cardsInCol[cardIndex + 1] ?? null) as HTMLElement | null;
  if (key === 'ArrowUp') {
    const targetIndex = cardIndex === -1 ? cardsInCol.length - 1 : cardIndex - 1;
    return (cardsInCol[targetIndex] ?? null) as HTMLElement | null;
  }
  if (key === 'ArrowRight') return getAdjacentColumnCard(cols, colIndex + 1, cardIndex);
  if (key === 'ArrowLeft') return getAdjacentColumnCard(cols, colIndex - 1, cardIndex);
  return null;
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

export interface DragTargetSnapshot {
  readonly overId: string;
  readonly destination: BoardTarget;
  readonly placement: MoveInput;
}

export type DragTargetSnapshotResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'found'; readonly target: DragTargetSnapshot };

export function dragTargetSnapshotFor(
  groups: readonly IssueGroup[],
  issue: Issue,
  overId: string,
  groupBy: GroupByField,
  resolveState: StateResolver | undefined,
  reorderable: boolean,
): DragTargetSnapshotResult {
  const directGroup = groups.find((group) => group.id === overId);
  let candidates: readonly IssueGroup[];
  if (directGroup === undefined) {
    const occurrences = groups.flatMap((group) =>
      group.issues.flatMap((entry) => (entry.id === overId ? [{ group, issue: entry }] : [])),
    );
    const newestSyncId = occurrences.reduce(
      (newest, occurrence) => Math.max(newest, occurrence.issue.syncId),
      Number.NEGATIVE_INFINITY,
    );
    const newest = occurrences.filter((occurrence) => occurrence.issue.syncId === newestSyncId);
    const targetIssue = newest[0]?.issue;
    if (targetIssue === undefined) return { kind: 'missing' };
    const fingerprint = issueBoardFingerprint(targetIssue);
    if (newest.some((occurrence) => issueBoardFingerprint(occurrence.issue) !== fingerprint)) {
      return { kind: 'ambiguous' };
    }
    candidates = newest
      .filter((occurrence) =>
        groupMatchesIssue(occurrence.group, occurrence.issue, groupBy, resolveState),
      )
      .map((occurrence) => occurrence.group);
  } else {
    candidates = [directGroup];
  }

  const targets = new Map<string, DragTargetSnapshot>();
  for (const group of candidates) {
    const placement = planDrop(
      [group],
      [issue, ...group.issues],
      issue.id,
      overId,
      groupBy,
      resolveState,
      reorderable,
    );
    const position = dropPositionFor([group], issue.id, overId);
    if (placement === null || position === null) continue;
    const destination: BoardTarget = reorderable
      ? { ...position, groupId: group.id }
      : { column: position.column, groupId: group.id };
    if (!targets.has(group.id)) targets.set(group.id, { overId, destination, placement });
  }
  if (targets.size === 0) return { kind: 'missing' };
  if (targets.size > 1) return { kind: 'ambiguous' };
  const target = targets.values().next().value;
  return target === undefined ? { kind: 'missing' } : { kind: 'found', target };
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
  disabled,
  onOpen,
  onNode,
}: {
  issue: Issue;
  lookups: CardLookups;
  properties: readonly DisplayProperty[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onNode: (id: string, node: HTMLLIElement | null, previousNode: HTMLLIElement | null) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { stateId: issue.stateId },
    disabled,
    attributes: { role: 'listitem' },
  });
  const registeredNode = useRef<HTMLLIElement | null>(null);
  const setCardNode = useCallback(
    (node: HTMLLIElement | null) => {
      const previousNode = registeredNode.current;
      registeredNode.current = node;
      setNodeRef(node);
      setActivatorNodeRef(node);
      onNode(issue.id, node, previousNode);
    },
    [issue.id, onNode, setNodeRef, setActivatorNodeRef],
  );

  return (
    <li
      ref={setCardNode}
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
      aria-label={`${issue.identifier}: ${issue.title}`}
      {...listeners}
    >
      <IssueCardView issue={issue} lookups={lookups} properties={properties} onOpen={onOpen} />
    </li>
  );
}

interface ActiveDragSession {
  readonly session: number;
  readonly issueId: string;
  readonly source: BoardSource;
  readonly keyboard: boolean;
  readonly departedSource: boolean;
  readonly endVisibilityActivity: () => void;
  readonly target?: DragTargetSnapshot;
}

interface PendingDragSettlement {
  readonly endVisibilityActivity: () => void;
  readonly frameId?: number;
}

interface BoardLifecycle {
  readonly generation: number;
  readonly mounted: boolean;
}

function dragSourceReturnStatus(
  session: ActiveDragSession,
  title: string,
  current: string,
): string {
  if (!session.departedSource && session.target === undefined) return current;
  return `Moved ${title} to ${boardPositionLabel(session.source)}.`;
}

interface DragDelta {
  readonly x: number;
  readonly y: number;
}

interface BoardFocusTarget {
  readonly issueId: string;
  readonly fallbackGroupId?: string;
  readonly requireIssueInFallback?: boolean;
}

interface BoardFocusOwnership {
  readonly request: number;
  readonly target: BoardFocusTarget;
  readonly expectedSession?: number;
  readonly focusAllowed?: () => boolean;
  readonly node: HTMLElement;
}

function boardFocusArrivalMayQueue(
  focused: Element | null,
  body: HTMLElement,
  arrivingCard: Element,
  fallbackColumn: Element | undefined,
  ownership: BoardFocusOwnership,
  latestRequest: number,
  latestSession: number,
  active: boolean,
): boolean {
  return (
    fallbackColumn !== undefined &&
    ownership.node === fallbackColumn &&
    fallbackColumn.contains(arrivingCard) &&
    (focused === ownership.node || focused === body) &&
    boardFocusRequestMayRun(
      ownership.request,
      latestRequest,
      ownership.expectedSession,
      latestSession,
      active,
      ownership.focusAllowed?.() !== false,
    )
  );
}

function registeredBoardFocusNode(
  target: BoardFocusTarget,
  cardNodes: ReadonlyMap<string, HTMLLIElement>,
  columnNodes: ReadonlyMap<string, HTMLUListElement>,
): HTMLElement | undefined {
  const card = cardNodes.get(target.issueId);
  const fallback =
    target.fallbackGroupId === undefined ? undefined : columnNodes.get(target.fallbackGroupId);
  if (
    target.requireIssueInFallback === true &&
    card !== undefined &&
    fallback !== undefined &&
    !fallback.contains(card)
  ) {
    return fallback;
  }
  return card ?? fallback;
}

export function boardFocusRequestMayRun(
  request: number,
  latestRequest: number,
  expectedSession: number | undefined,
  latestSession: number,
  active: boolean,
  focusAllowed = true,
): boolean {
  return (
    request === latestRequest &&
    (expectedSession === undefined || expectedSession === latestSession) &&
    !active &&
    focusAllowed
  );
}

export function boardFocusRemountMayQueue(
  focused: Element | null,
  body: HTMLElement,
  previous: Element,
  request: number,
  latestRequest: number,
  expectedSession: number | undefined,
  latestSession: number,
  active: boolean,
): boolean {
  return (
    (focused === previous || focused === body) &&
    boardFocusRequestMayRun(request, latestRequest, expectedSession, latestSession, active)
  );
}

function sameDragDelta(left: DragDelta, right: DragDelta): boolean {
  return left.x === right.x && left.y === right.y;
}

export function sameBoardSource(left: BoardTarget, right: BoardTarget): boolean {
  return left.groupId === right.groupId && left.position === right.position;
}

type DragEndTarget =
  | { readonly kind: 'source' }
  | { readonly kind: 'destination'; readonly overId: string }
  | { readonly kind: 'invalid' };

type DragSourceState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'pending'; readonly issue: Issue }
  | { readonly kind: 'ambiguous'; readonly issue: Issue }
  | { readonly kind: 'moved'; readonly issue: Issue; readonly source: BoardSource }
  | { readonly kind: 'current'; readonly issue: Issue; readonly source: BoardSource };

function dragSourceStateFor(
  groups: readonly IssueGroup[],
  session: ActiveDragSession,
  groupBy: GroupByField,
  resolveState: StateResolver | undefined,
): DragSourceState {
  const snapshot = dragSourceSnapshotFor(groups, session.issueId, groupBy, resolveState);
  if (snapshot.kind !== 'found') return snapshot;
  return sameBoardSource(snapshot.source, session.source)
    ? { kind: 'current', issue: snapshot.issue, source: snapshot.source }
    : { kind: 'moved', issue: snapshot.issue, source: snapshot.source };
}

function dragEndTargetFor(
  session: ActiveDragSession,
  dragId: string,
  eventOverId: string | null,
): DragEndTarget {
  if (eventOverId === null) return { kind: 'invalid' };
  if (session.target === undefined) {
    return dragId === eventOverId ? { kind: 'source' } : { kind: 'invalid' };
  }
  return session.target.overId === eventOverId
    ? { kind: 'destination', overId: session.target.overId }
    : { kind: 'invalid' };
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
  filtered = false,
  onVisibilityActivityStart,
}: BoardProps) {
  const { labelById, memberById, stateById, projects, cycles, openQuickCreate } = useWorkspace();
  const queryClient = useQueryClient();
  const move = useMoveIssue();
  const positionsIncomplete = boardPositionsAreIncomplete(filtered, columnSource?.display);
  const boardPage = useBoardPage(columnSource ?? EMPTY_COLUMN, columnSource !== undefined);
  const columnsReady = columnsReadyFor(columnSource, boardPage.isPending);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragStatus, setDragStatus] = useState('');
  const [peekId, setPeekId] = useState<string | null>(null);
  const [loadedRowMap, setLoadedRowMap] = useState<ReadonlyMap<string, readonly Issue[]>>(
    new Map(),
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const latestSession = useRef(0);
  const latestFocusRequest = useRef(0);
  const boardFocusOwnership = useRef<BoardFocusOwnership | undefined>(undefined);
  const activeSession = useRef<ActiveDragSession | undefined>(undefined);
  const pendingSettlements = useRef<Map<number, PendingDragSettlement>>(new Map());
  const lifecycle = useRef<BoardLifecycle>({ generation: 0, mounted: false });
  const columnRows = useRef<Map<string, readonly Issue[]>>(new Map());
  const dragDelta = useRef<DragDelta>({ x: 0, y: 0 });
  const suppressedOverDelta = useRef<DragDelta | undefined>(undefined);
  const pendingIssueIds = useRef<Set<string>>(new Set());
  const cardNodes = useRef<Map<string, HTMLLIElement>>(new Map());
  const columnNodes = useRef<Map<string, HTMLUListElement>>(new Map());
  const boardNode = useRef<HTMLDivElement | null>(null);
  const dragged = useRef<Issue | undefined>(undefined);
  const sensorController = useMemo(() => createBoardSensorController(), []);
  const groupShells = useRef<readonly IssueGroup[]>([]);
  if (groups.length > 0) {
    groupShells.current = groups.map((group) => ({
      ...group,
      issues: [],
      subGroups: [],
      total: 0,
    }));
  }
  const renderedGroups = groups.length > 0 ? groups : groupShells.current;

  const releasePendingSettlement = useCallback((session: number, cancelFrame: boolean) => {
    const pending = pendingSettlements.current.get(session);
    if (pending === undefined) return;
    pendingSettlements.current.delete(session);
    if (cancelFrame && pending.frameId !== undefined) {
      window.cancelAnimationFrame(pending.frameId);
    }
    pending.endVisibilityActivity();
  }, []);

  useLayoutEffect(() => {
    const generation = lifecycle.current.generation + 1;
    lifecycle.current = { generation, mounted: true };
    return () => {
      lifecycle.current = { generation: generation + 1, mounted: false };
      latestSession.current += 1;
      latestFocusRequest.current += 1;
      boardFocusOwnership.current = undefined;
      activeSession.current?.endVisibilityActivity();
      activeSession.current = undefined;
      for (const session of [...pendingSettlements.current.keys()]) {
        releasePendingSettlement(session, true);
      }
    };
  }, [releasePendingSettlement]);

  useLayoutEffect(() => {
    if (!draggable) {
      activeSession.current?.endVisibilityActivity();
      activeSession.current = undefined;
      dragged.current = undefined;
      suppressedOverDelta.current = undefined;
      latestSession.current += 1;
      latestFocusRequest.current += 1;
      boardFocusOwnership.current = undefined;
      setActiveId(null);
      setDragStatus('');
      return;
    }
    sensorController.mount();
    return () => {
      activeSession.current?.endVisibilityActivity();
      sensorController.unmount();
    };
  }, [draggable, sensorController]);

  const setIssuePending = useCallback((issueId: string, pending: boolean) => {
    if (pending) pendingIssueIds.current.add(issueId);
    else pendingIssueIds.current.delete(issueId);
    setPendingIds(new Set(pendingIssueIds.current));
  }, []);

  const scheduleBoardFocus = useCallback(
    (target: BoardFocusTarget, expectedSession?: number, focusAllowed?: () => boolean) => {
      const request = latestFocusRequest.current + 1;
      const lifecycleGeneration = lifecycle.current.generation;
      latestFocusRequest.current = request;
      boardFocusOwnership.current = undefined;
      window.requestAnimationFrame(() => {
        if (
          !lifecycle.current.mounted ||
          lifecycle.current.generation !== lifecycleGeneration ||
          !boardFocusRequestMayRun(
            request,
            latestFocusRequest.current,
            expectedSession,
            latestSession.current,
            activeSession.current !== undefined,
            focusAllowed?.() !== false,
          )
        ) {
          return;
        }
        const node = registeredBoardFocusNode(target, cardNodes.current, columnNodes.current);
        if (node === undefined || !node.isConnected) return;
        const ownership: BoardFocusOwnership = {
          request,
          target,
          node,
          ...(expectedSession === undefined ? {} : { expectedSession }),
          ...(focusAllowed === undefined ? {} : { focusAllowed }),
        };
        boardFocusOwnership.current = ownership;
        node.addEventListener(
          'blur',
          (event) => {
            if (event.relatedTarget !== null) {
              if (boardFocusOwnership.current === ownership) {
                boardFocusOwnership.current = undefined;
              }
              return;
            }
            window.requestAnimationFrame(() => {
              if (
                lifecycle.current.mounted &&
                lifecycle.current.generation === lifecycleGeneration &&
                node.isConnected &&
                boardFocusOwnership.current === ownership
              ) {
                boardFocusOwnership.current = undefined;
              }
            });
          },
          { once: true },
        );
        node.focus();
        if (document.activeElement !== node && boardFocusOwnership.current === ownership) {
          boardFocusOwnership.current = undefined;
        }
      });
    },
    [],
  );

  const registerColumnNode = useCallback(
    (groupId: string, node: HTMLUListElement | null) => {
      if (node !== null) {
        columnNodes.current.set(groupId, node);
        return;
      }
      const previous = columnNodes.current.get(groupId);
      columnNodes.current.delete(groupId);
      const ownership = boardFocusOwnership.current;
      if (
        previous === undefined ||
        ownership === undefined ||
        ownership.node !== previous ||
        ownership.target.fallbackGroupId !== groupId ||
        !boardFocusRemountMayQueue(
          document.activeElement,
          document.body,
          previous,
          ownership.request,
          latestFocusRequest.current,
          ownership.expectedSession,
          latestSession.current,
          activeSession.current !== undefined,
        )
      ) {
        return;
      }
      scheduleBoardFocus(
        { ...ownership.target, requireIssueInFallback: true },
        ownership.expectedSession,
        ownership.focusAllowed,
      );
    },
    [scheduleBoardFocus],
  );

  const registerCardNode = useCallback(
    (issueId: string, node: HTMLLIElement | null, previousNode: HTMLLIElement | null) => {
      if (node !== null) {
        cardNodes.current.set(issueId, node);
        const ownership = boardFocusOwnership.current;
        if (
          ownership !== undefined &&
          ownership.target.issueId === issueId &&
          boardFocusArrivalMayQueue(
            document.activeElement,
            document.body,
            node,
            ownership.target.fallbackGroupId === undefined
              ? undefined
              : columnNodes.current.get(ownership.target.fallbackGroupId),
            ownership,
            latestFocusRequest.current,
            latestSession.current,
            activeSession.current !== undefined,
          )
        ) {
          scheduleBoardFocus(ownership.target, ownership.expectedSession, ownership.focusAllowed);
        }
        return;
      }
      if (previousNode === null || cardNodes.current.get(issueId) !== previousNode) return;
      const previous = previousNode;
      cardNodes.current.delete(issueId);
      const ownership = boardFocusOwnership.current;
      if (
        previous === undefined ||
        ownership === undefined ||
        ownership.node !== previous ||
        ownership.target.issueId !== issueId ||
        ownership.target.fallbackGroupId === undefined ||
        !boardFocusRemountMayQueue(
          document.activeElement,
          document.body,
          previous,
          ownership.request,
          latestFocusRequest.current,
          ownership.expectedSession,
          latestSession.current,
          activeSession.current !== undefined,
        )
      ) {
        return;
      }
      scheduleBoardFocus(
        {
          issueId,
          fallbackGroupId: ownership.target.fallbackGroupId,
          requireIssueInFallback: true,
        },
        ownership.expectedSession,
        ownership.focusAllowed,
      );
    },
    [scheduleBoardFocus],
  );

  const resetDndSensor = useCallback(
    (status: string, focusTarget?: BoardFocusTarget) => {
      sensorController.cancel();
      if (focusTarget !== undefined) scheduleBoardFocus(focusTarget);
      setDragStatus(status);
    },
    [scheduleBoardFocus, sensorController],
  );

  const cancelActiveDrag = useCallback(
    (status: string, focusTarget?: BoardFocusTarget) => {
      const session = activeSession.current;
      session?.endVisibilityActivity();
      activeSession.current = undefined;
      dragged.current = undefined;
      suppressedOverDelta.current = undefined;
      latestSession.current += 1;
      latestFocusRequest.current += 1;
      boardFocusOwnership.current = undefined;
      setActiveId(null);
      const keyboardTarget =
        session?.keyboard === true
          ? (focusTarget ?? {
              issueId: session.issueId,
              fallbackGroupId: session.source.groupId,
            })
          : undefined;
      resetDndSensor(status, keyboardTarget);
    },
    [resetDndSensor],
  );

  const publishRows = useCallback(
    (groupId: string, rows: readonly Issue[]) => {
      if (columnSource === undefined) return;
      if (columnRows.current.get(groupId) === rows) return;
      columnRows.current.set(groupId, rows);
      setLoadedRowMap(new Map(columnRows.current));
    },
    [columnSource],
  );

  const loadedGroups = useCallback(() => {
    if (columnSource === undefined) return groups;
    return groups.map((group) => {
      const rows = loadedRowMap.get(group.id);
      return rows === undefined || rows === group.issues ? group : { ...group, issues: rows };
    });
  }, [groups, columnSource, loadedRowMap]);

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
    useSensor(sensorController.Pointer, { activationConstraint: { distance: 4 } }),
    useSensor(sensorController.Keyboard, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const peekIssue =
    peekId === null ? undefined : issuesInPlay().find((issue) => issue.id === peekId);
  const activeIssue = activeId === null ? undefined : dragged.current;
  const liveActiveIssue =
    activeId === null ? undefined : newestIssueFor([...loadedGroups(), ...groups], activeId);
  useEffect(() => {
    if (activeId === null || dragged.current === undefined || liveActiveIssue !== undefined) return;
    const identifier = dragged.current.identifier;
    const timeout = window.setTimeout(() => {
      if (issuesInPlay().some((issue) => issue.id === activeId)) return;
      cancelActiveDrag(`${identifier} is no longer visible. Drag cancelled.`);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [activeId, liveActiveIssue, issuesInPlay, cancelActiveDrag]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fail-closed drag reconciliation keeps each outcome explicit
  useEffect(() => {
    if (activeId === null || dragged.current === undefined || liveActiveIssue === undefined) return;

    const previousIssue = dragged.current;
    const session = activeSession.current;
    if (session === undefined) return;
    const reconciliationGroups = [...loadedGroups(), ...groups];
    const sourceState = dragSourceStateFor(reconciliationGroups, session, groupBy, resolveState);
    if (sourceState.kind === 'pending' || sourceState.kind === 'missing') return;
    if (sourceState.kind === 'ambiguous') {
      cancelActiveDrag(
        `${sourceState.issue.identifier}'s position changed in the background. Drag cancelled.`,
      );
      return;
    }
    if (sourceState.kind === 'moved') {
      cancelActiveDrag(
        `${sourceState.issue.identifier} moved in the background to ${boardPositionLabel(sourceState.source)}. Drag cancelled.`,
        { issueId: sourceState.issue.id, fallbackGroupId: sourceState.source.groupId },
      );
      return;
    }
    dragged.current = sourceState.issue;
    if (previousIssue.syncId !== sourceState.issue.syncId) {
      suppressedOverDelta.current = { ...dragDelta.current };
    }
    const previousTarget = session.target;
    const targetState =
      previousTarget === undefined
        ? undefined
        : dragTargetSnapshotFor(
            reconciliationGroups,
            sourceState.issue,
            previousTarget.overId,
            groupBy,
            resolveState,
            reorderable,
          );
    if (
      previousTarget !== undefined &&
      (targetState?.kind !== 'found' ||
        !sameBoardSource(previousTarget.destination, targetState.target.destination))
    ) {
      cancelActiveDrag(
        `${sourceState.issue.identifier}'s drop target changed in the background. Drag cancelled at ${boardPositionLabel(sourceState.source)}.`,
        { issueId: sourceState.issue.id, fallbackGroupId: sourceState.source.groupId },
      );
      return;
    }
    activeSession.current = {
      session: session.session,
      issueId: session.issueId,
      source: sourceState.source,
      keyboard: session.keyboard,
      departedSource: session.departedSource,
      endVisibilityActivity: session.endVisibilityActivity,
      ...(targetState?.kind === 'found' ? { target: targetState.target } : {}),
    };
  }, [
    activeId,
    liveActiveIssue,
    loadedGroups,
    groups,
    groupBy,
    resolveState,
    reorderable,
    cancelActiveDrag,
  ]);

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (pendingIssueIds.current.has(id)) return;
    const issue = issuesInPlay().find((entry) => entry.id === id);
    const source = currentSourceFor(loadedGroups(), id);
    latestSession.current += 1;
    latestFocusRequest.current += 1;
    boardFocusOwnership.current = undefined;
    dragDelta.current = { x: 0, y: 0 };
    suppressedOverDelta.current = undefined;
    activeSession.current =
      issue === undefined || source === null
        ? undefined
        : {
            session: latestSession.current,
            issueId: issue.id,
            source,
            keyboard: event.activatorEvent.type === 'keydown',
            departedSource: false,
            endVisibilityActivity: onVisibilityActivityStart?.() ?? (() => undefined),
          };
    dragged.current = issue;
    setActiveId(id);
    if (issue !== undefined && source !== null) {
      setDragStatus(
        `Picked up ${issue.identifier}: ${issue.title} in ${boardPositionLabel(source)}.`,
      );
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    dragDelta.current = { ...event.delta };
  };

  const handleDragOver = (event: DragOverEvent) => {
    const session = activeSession.current;
    if (session === undefined || session.issueId !== String(event.active.id)) return;
    const suppressedDelta = suppressedOverDelta.current;
    if (suppressedDelta !== undefined && sameDragDelta(suppressedDelta, event.delta)) return;
    suppressedOverDelta.current = undefined;
    const currentGroups = loadedGroups();
    const currentIssues = issuesInPlay();
    const title = currentIssues.find((issue) => issue.id === session.issueId)?.identifier ?? 'item';
    if (event.over === null) {
      activeSession.current = {
        session: session.session,
        issueId: session.issueId,
        source: session.source,
        keyboard: session.keyboard,
        departedSource: true,
        endVisibilityActivity: session.endVisibilityActivity,
      };
      setDragStatus(`Moving ${title} outside of the board.`);
      return;
    }
    const overId = String(event.over.id);
    if (overId === session.issueId) {
      activeSession.current = {
        session: session.session,
        issueId: session.issueId,
        source: session.source,
        keyboard: session.keyboard,
        departedSource: session.departedSource,
        endVisibilityActivity: session.endVisibilityActivity,
      };
      setDragStatus((current) => dragSourceReturnStatus(session, title, current));
      return;
    }
    const heldIssue = currentIssues.find((issue) => issue.id === session.issueId);
    const targetState =
      heldIssue === undefined
        ? { kind: 'missing' as const }
        : dragTargetSnapshotFor(
            currentGroups,
            heldIssue,
            overId,
            groupBy,
            resolveState,
            reorderable,
          );
    if (targetState.kind !== 'found') {
      activeSession.current = {
        session: session.session,
        issueId: session.issueId,
        source: session.source,
        keyboard: session.keyboard,
        departedSource: true,
        endVisibilityActivity: session.endVisibilityActivity,
      };
      setDragStatus(`Cannot move ${title} here.`);
      return;
    }
    activeSession.current = { ...session, departedSource: true, target: targetState.target };
    setDragStatus(`Moved ${title} to ${boardPositionLabel(targetState.target.destination)}.`);
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fail-closed drag completion keeps each outcome explicit
  const handleDragEnd = (event: DragEndEvent) => {
    const dragId = String(event.active.id);
    const session = activeSession.current;
    const heldIssue = dragged.current;
    const title = heldIssue?.identifier ?? 'item';

    if (session === undefined || session.session !== latestSession.current) {
      session?.endVisibilityActivity();
      activeSession.current = undefined;
      suppressedOverDelta.current = undefined;
      setActiveId(null);
      dragged.current = undefined;
      return;
    }
    const reconciliationGroups = [...loadedGroups(), ...groups];
    const sourceState = dragSourceStateFor(reconciliationGroups, session, groupBy, resolveState);
    const target = dragEndTargetFor(
      session,
      dragId,
      event.over === null ? null : String(event.over.id),
    );
    const currentTarget =
      sourceState.kind === 'current' && target.kind === 'destination'
        ? dragTargetSnapshotFor(
            reconciliationGroups,
            sourceState.issue,
            target.overId,
            groupBy,
            resolveState,
            reorderable,
          )
        : undefined;

    activeSession.current = undefined;
    suppressedOverDelta.current = undefined;
    setActiveId(null);
    dragged.current = undefined;

    if (sourceState.kind === 'missing') {
      latestSession.current += 1;
      if (session.keyboard) {
        scheduleBoardFocus({ issueId: session.issueId, fallbackGroupId: session.source.groupId });
      }
      setDragStatus(`${title} is no longer visible. Drag cancelled.`);
      session.endVisibilityActivity();
      return;
    }
    if (sourceState.kind === 'pending' || sourceState.kind === 'ambiguous') {
      latestSession.current += 1;
      if (session.keyboard) {
        scheduleBoardFocus({ issueId: session.issueId, fallbackGroupId: session.source.groupId });
      }
      setDragStatus(`${sourceState.issue.identifier}'s position changed. Drag cancelled.`);
      session.endVisibilityActivity();
      return;
    }
    if (sourceState.kind === 'moved') {
      latestSession.current += 1;
      if (session.keyboard) {
        scheduleBoardFocus({
          issueId: sourceState.issue.id,
          fallbackGroupId: sourceState.source.groupId,
        });
      }
      setDragStatus(
        `${sourceState.issue.identifier} moved in the background to ${boardPositionLabel(sourceState.source)}. Drag cancelled.`,
      );
      session.endVisibilityActivity();
      return;
    }
    const currentTitle = sourceState.issue.identifier;
    if (target.kind === 'invalid') {
      if (session.keyboard) {
        scheduleBoardFocus(
          { issueId: sourceState.issue.id, fallbackGroupId: session.source.groupId },
          session.session,
        );
      }
      setDragStatus(
        `Could not drop ${currentTitle}. Returned to ${boardPositionLabel(session.source)}.`,
      );
      session.endVisibilityActivity();
      return;
    }
    if (target.kind === 'source') {
      if (session.keyboard) {
        scheduleBoardFocus(
          { issueId: sourceState.issue.id, fallbackGroupId: session.source.groupId },
          session.session,
        );
      }
      setDragStatus(`Dropped ${currentTitle} in ${boardPositionLabel(session.source)}.`);
      session.endVisibilityActivity();
      return;
    }
    if (
      currentTarget?.kind !== 'found' ||
      session.target === undefined ||
      !sameBoardSource(session.target.destination, currentTarget.target.destination)
    ) {
      latestSession.current += 1;
      if (session.keyboard) {
        scheduleBoardFocus({
          issueId: sourceState.issue.id,
          fallbackGroupId: sourceState.source.groupId,
        });
      }
      setDragStatus(
        `${currentTitle}'s drop target changed in the background. Drag cancelled at ${boardPositionLabel(sourceState.source)}.`,
      );
      session.endVisibilityActivity();
      return;
    }
    const placement = currentTarget.target.placement;
    const destination = currentTarget.target.destination;

    const completed: CompletedDrag = {
      session: session.session,
      identifier: currentTitle,
      source: session.source,
      destination,
    };
    const lifecycleGeneration = lifecycle.current.generation;
    pendingSettlements.current.set(completed.session, {
      endVisibilityActivity: session.endVisibilityActivity,
    });
    const restoreCompletedKeyboardFocus = (preferredGroupId: string, alternateGroupId: string) => {
      const preferredColumn = columnNodes.current.get(preferredGroupId);
      const alternateColumn = columnNodes.current.get(alternateGroupId);
      let fallbackGroupId: string | null = null;
      if (preferredColumn !== undefined) fallbackGroupId = preferredGroupId;
      else if (alternateColumn !== undefined) fallbackGroupId = alternateGroupId;
      if (fallbackGroupId === null) return;
      const focusIsOwned = () =>
        focusRemainsBoardOwned(
          document.activeElement,
          document.body,
          cardNodes.current.get(dragId),
          preferredColumn,
          alternateColumn,
        );
      if (
        session.keyboard &&
        latestSession.current === completed.session &&
        activeSession.current === undefined &&
        focusIsOwned()
      ) {
        scheduleBoardFocus(
          {
            issueId: dragId,
            fallbackGroupId,
            requireIssueInFallback: true,
          },
          completed.session,
          focusIsOwned,
        );
      }
    };
    const publishResult = (
      outcome: SettledDragStatusInput['outcome'],
      settled: Issue | undefined,
      settlement?: IssueMoveSettlement,
    ) => {
      if (!lifecycle.current.mounted || lifecycle.current.generation !== lifecycleGeneration) {
        releasePendingSettlement(completed.session, true);
        return;
      }
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: settlement keeps every terminal outcome explicit
      const frameId = window.requestAnimationFrame(() => {
        if (!lifecycle.current.mounted || lifecycle.current.generation !== lifecycleGeneration) {
          releasePendingSettlement(completed.session, false);
          return;
        }
        const result = currentCompletedDragResult({
          queryClient,
          dragId,
          deletionGeneration,
          settlement,
          outcome,
          settled,
          completed,
          filtered: positionsIncomplete,
          latestSession: latestSession.current,
          activeSession: activeSession.current?.session ?? null,
          cardNodes: cardNodes.current,
          columnNodes: columnNodes.current,
        });
        if (result.status !== null) {
          setDragStatus(result.status);
        }
        if (result.status !== null && result.focusGroupId !== null) {
          const alternateGroupId =
            outcome === 'success' ? session.source.groupId : destination.groupId;
          restoreCompletedKeyboardFocus(result.focusGroupId, alternateGroupId);
        }
        releasePendingSettlement(completed.session, false);
      });
      const pending = pendingSettlements.current.get(completed.session);
      if (pending === undefined) {
        window.cancelAnimationFrame(frameId);
        return;
      }
      pendingSettlements.current.set(completed.session, { ...pending, frameId });
    };
    const deletionGeneration = issueDeletionGeneration(queryClient, dragId);
    setIssuePending(dragId, true);
    setDragStatus(
      `Dropping ${currentTitle} from ${boardPositionLabel(session.source)} to ${boardPositionLabel(destination)}.`,
    );
    const pendingMove = move.mutateAsync(placement);
    restoreCompletedKeyboardFocus(destination.groupId, session.source.groupId);
    pendingMove
      .then(
        (settlement) => {
          if (!lifecycle.current.mounted || lifecycle.current.generation !== lifecycleGeneration) {
            releasePendingSettlement(completed.session, true);
            return;
          }
          publishResult(
            'success',
            settlement.issues.find((issue) => issue.id === dragId),
            settlement,
          );
          setIssuePending(dragId, false);
        },
        () => {
          if (!lifecycle.current.mounted || lifecycle.current.generation !== lifecycleGeneration) {
            releasePendingSettlement(completed.session, true);
            return;
          }
          publishResult('error', placement.issue);
          setIssuePending(dragId, false);
        },
      )
      .catch(() => undefined);
  };

  const handleDragCancel = () => {
    const session = activeSession.current;
    const issue = dragged.current;
    if (session === undefined && issue === undefined) return;
    activeSession.current = undefined;
    dragged.current = undefined;
    suppressedOverDelta.current = undefined;
    setActiveId(null);
    if (session !== undefined && issue !== undefined) {
      if (session.keyboard) {
        scheduleBoardFocus(
          { issueId: issue.id, fallbackGroupId: session.source.groupId },
          session.session,
        );
      }
      setDragStatus(
        `Cancelled dragging ${issue.identifier}. Returned to ${boardPositionLabel(session.source)}.`,
      );
    }
    session?.endVisibilityActivity();
  };

  const handleBoardKeyDown = (e: React.KeyboardEvent) => {
    if (activeId !== null) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    const currentFocus = document.activeElement;
    const board = boardNode.current;
    if (currentFocus === null || board === null) return;
    const dom = getDOMIndices(currentFocus, board);
    if (dom === null) return;

    e.preventDefault();
    const { cols, colIndex, cardsInCol, cardIndex } = dom;

    const nextFocus = getNextCardTarget(e.key, cols, colIndex, cardsInCol, cardIndex);
    if (nextFocus !== null) nextFocus.focus();
  };

  const accessibility = useMemo(
    () => ({
      announcements: {
        onDragStart: () => undefined,
        onDragOver: () => undefined,
        onDragEnd: () => undefined,
        onDragCancel: () => undefined,
      },
      restoreFocus: false,
      screenReaderInstructions: {
        draggable:
          'To pick up this issue, press Space or Enter. While dragging, use the arrow keys to move it. Press Space or Enter again to drop, or Escape to cancel.',
      },
    }),
    [],
  );

  const columns = (
    // biome-ignore lint/a11y/noStaticElementInteractions: event delegation for focus management
    <div
      ref={boardNode}
      className="flex h-full min-h-0 gap-3 overflow-x-auto p-3"
      onKeyDown={handleBoardKeyDown}
    >
      {renderedGroups.map((group) => (
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
          pendingIssueIds={pendingIds}
          onCreate={() => openQuickCreate()}
          onCardNode={registerCardNode}
          onColumnNode={registerColumnNode}
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
      accessibility={accessibility}
      onDragStart={onDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {columns}

      <DragOverlay dropAnimation={null}>
        {activeIssue === undefined ? null : (
          <div aria-hidden="true" inert className="pointer-events-none">
            <IssueCardView issue={activeIssue} lookups={lookups} properties={properties} dragging />
          </div>
        )}
      </DragOverlay>

      <div
        data-testid="board-drag-status"
        className="sr-only"
        role="status"
        aria-live="assertive"
        aria-atomic="true"
      >
        {dragStatus}
      </div>

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
  readonly pendingIssueIds: ReadonlySet<string>;
  readonly onCreate: () => void;
  readonly onCardNode: (
    id: string,
    node: HTMLLIElement | null,
    previousNode: HTMLLIElement | null,
  ) => void;
  readonly onColumnNode: (id: string, node: HTMLUListElement | null) => void;
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
  pendingIssueIds,
  onCreate,
  onCardNode,
  onColumnNode,
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

  useLayoutEffect(() => {
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
      onColumnNode(group.id, node);
      if (draggable) setNodeRef(node);
    },
    [draggable, group.id, onColumnNode, setNodeRef],
  );

  const cards = visibleIssues.map((issue) =>
    draggable ? (
      <SortableCard
        key={issue.id}
        issue={issue}
        lookups={lookups}
        properties={properties}
        disabled={pendingIssueIds.has(issue.id)}
        onNode={onCardNode}
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

  const listClass =
    'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-b-lg p-2 pt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

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
          <ul
            ref={setScrollNode}
            onScroll={markScrolled}
            className={listClass}
            tabIndex={-1}
            aria-label={`${group.title} issues`}
          >
            {cards}
            {footer}
          </ul>
        </SortableContext>
      ) : (
        <ul
          ref={setScrollNode}
          onScroll={markScrolled}
          className={listClass}
          tabIndex={-1}
          aria-label={`${group.title} issues`}
        >
          {cards}
          {footer}
        </ul>
      )}
    </section>
  );
}
