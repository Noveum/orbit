import type { schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';

export type IssueRow = typeof schema.issue.$inferSelect;
export type IssueValues = Partial<typeof schema.issue.$inferInsert>;

export function issueScopes(
  row: Pick<IssueRow, 'organizationId' | 'teamId' | 'id' | 'projectId'>,
): string[] {
  const list = [scopes.team(row.teamId), scopes.issue(row.id)];
  if (row.projectId !== null) list.push(scopes.project(row.projectId));
  return list;
}

export function stateTimestamps(category: string, now: Date): IssueValues {
  if (category === 'completed') {
    return { completedAt: now, canceledAt: null, stateEnteredAt: now };
  }
  if (category === 'canceled') {
    return { canceledAt: now, completedAt: null, stateEnteredAt: now };
  }
  if (category === 'started' || category === 'review') {
    return { startedAt: now, completedAt: null, canceledAt: null, stateEnteredAt: now };
  }
  return { startedAt: null, completedAt: null, canceledAt: null, stateEnteredAt: now };
}

export function applyStateTimestamps(current: IssueRow, category: string, now: Date): IssueValues {
  const next = stateTimestamps(category, now);
  if ((category === 'started' || category === 'review') && current.startedAt !== null) {
    return { ...next, startedAt: current.startedAt };
  }
  if (category === 'completed') {
    return { ...next, startedAt: current.startedAt ?? now };
  }
  return next;
}
