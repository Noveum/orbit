import {
  type IssueListRow,
  listMembers,
  listWorkflowStates,
  reviewerIdsByIssue,
} from '@orbit/core';
import { db } from '@orbit/db';
import { PRIORITY_LABELS } from '@orbit/shared/constants';
import type { SyncAction } from '@orbit/shared/events';
import type { Principal } from '@orbit/shared/policy';

const PRIORITY_NAMES: Record<number, string> = PRIORITY_LABELS;

export interface IssueView {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly teamId: string;
  readonly state: string | null;
  readonly stateId: string;
  readonly priority: string;
  readonly assignee: string | null;
  readonly assigneeId: string | null;
  readonly reviewers: readonly string[];
  readonly reviewerIds: readonly string[];
  readonly projectId: string | null;
  readonly cycleId: string | null;
  readonly milestoneId: string | null;
  readonly parentId: string | null;
  readonly estimate: number | null;
  readonly dueDate: string | null;
  readonly archived: boolean;
  readonly updatedAt: string;
}

export interface DeltaView {
  readonly model: string;
  readonly action: string;
  readonly id: string;
}

export function deltaViews(actions: readonly SyncAction[]): DeltaView[] {
  return actions.map((action) => ({
    model: action.model,
    action: action.action,
    id: action.modelId,
  }));
}

function toView(
  row: IssueListRow,
  stateNames: ReadonlyMap<string, string>,
  userNames: ReadonlyMap<string, string>,
  reviewerIds: readonly string[],
): IssueView {
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    teamId: row.teamId,
    state: stateNames.get(row.stateId) ?? null,
    stateId: row.stateId,
    priority: PRIORITY_NAMES[row.priority] ?? 'No priority',
    assignee: row.assigneeId === null ? null : (userNames.get(row.assigneeId) ?? null),
    assigneeId: row.assigneeId,
    reviewers: reviewerIds.map((id) => userNames.get(id) ?? id),
    reviewerIds: [...reviewerIds],
    projectId: row.projectId,
    cycleId: row.cycleId,
    milestoneId: row.milestoneId,
    parentId: row.parentId,
    estimate: row.estimate,
    dueDate: row.dueDate,
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function describeIssues(
  principal: Principal,
  rows: readonly IssueListRow[],
): Promise<IssueView[]> {
  if (rows.length === 0) return [];

  const stateNames = new Map<string, string>();
  for (const teamId of new Set(rows.map((row) => row.teamId))) {
    for (const state of await listWorkflowStates(principal, teamId)) {
      stateNames.set(state.id, state.name);
    }
  }

  const [members, reviewers] = await Promise.all([
    listMembers(principal),
    reviewerIdsByIssue(
      db,
      rows.map((row) => row.id),
    ),
  ]);
  const userNames = new Map<string, string>();
  for (const member of members) userNames.set(member.user.id, member.user.name);

  return rows.map((row) => toView(row, stateNames, userNames, reviewers.get(row.id) ?? []));
}

export async function describeIssue(principal: Principal, row: IssueListRow): Promise<IssueView> {
  const [view] = await describeIssues(principal, [row]);
  if (view === undefined) throw new Error('The issue could not be described.');
  return view;
}
