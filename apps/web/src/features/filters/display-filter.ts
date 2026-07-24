import type { DisplayOptions } from '@orbit/shared/filters';
import type { Issue, WorkflowState } from '@/lib/query/schemas.ts';
import { COMPLETED_WINDOW_DAYS } from './view-config.ts';

const DAY_MS = 86_400_000;

export interface DisplayFilterResult {
  readonly issues: readonly Issue[];
  readonly hidden: number;
}

function completedCutoff(days: number | null, now: number): number | null {
  return days === null ? null : now - days * DAY_MS;
}

function isCompleted(issue: Issue, states: ReadonlyMap<string, WorkflowState>): boolean {
  const category = states.get(issue.stateId)?.category;
  return category === 'completed' || category === 'canceled';
}

function completedAtMs(issue: Issue): number | null {
  const stamp = issue.completedAt ?? issue.canceledAt ?? issue.updatedAt;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? null : parsed;
}

export function applyDisplayFilters(
  issues: readonly Issue[],
  display: DisplayOptions,
  states: ReadonlyMap<string, WorkflowState>,
  now: number = Date.now(),
): DisplayFilterResult {
  const cutoff = completedCutoff(COMPLETED_WINDOW_DAYS[display.showCompleted], now);
  const kept = issues.filter((issue) => {
    if (!display.showSubIssues && issue.parentId !== null) return false;
    if (cutoff === null || !isCompleted(issue, states)) return true;
    if (display.showCompleted === 'none') return false;
    const finished = completedAtMs(issue);
    return finished === null ? true : finished >= cutoff;
  });
  return { issues: kept, hidden: issues.length - kept.length };
}

export function displayFiltersHideRows(display: DisplayOptions): boolean {
  return !display.showSubIssues || display.showCompleted !== 'all';
}
