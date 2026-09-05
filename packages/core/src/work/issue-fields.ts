import type { schema } from '@orbit/db';
import { scopes } from '@orbit/shared/events';

export type IssueRow = typeof schema.issue.$inferSelect;
export type IssueValues = Partial<typeof schema.issue.$inferInsert>;

export function issueScopes(row: Pick<IssueRow, 'teamId' | 'id'>): string[] {
  return [scopes.team(row.teamId), scopes.issue(row.id)];
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
