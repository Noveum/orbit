import { and, db, eq, ilike, inArray, isNull, or, schema, sql } from '@orbit/db';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import type { Principal } from '@orbit/shared/policy';
import { assertCan } from '@orbit/shared/policy';
import type { IssueFilterInput } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import type { FilterContext } from './issue-predicates.ts';
import { buildFilterFilters } from './issue-predicates.ts';

export type IssueVisibility = 'team' | 'workspace-analytics';

export interface IssueWhereInput {
  readonly visibility: IssueVisibility;
  readonly filter: IssueFilterInput;
  readonly now: Date;
  readonly calendar?: FilterContext['calendar'];
  readonly advancedFilter?: 'include' | 'omit';
}

export function visibleTeamFilters(principal: Principal): SQL[] {
  if (principal.role === 'admin') return [];
  if (principal.teamIds.length === 0) return [sql`false`];
  return [inArray(schema.issue.teamId, [...principal.teamIds])];
}

function visibilityFilters(principal: Principal, visibility: IssueVisibility): SQL[] {
  if (visibility === 'workspace-analytics') {
    assertCan(principal, 'analytics:read');
    return [];
  }
  assertCan(principal, 'issue:read');
  return visibleTeamFilters(principal);
}

function directFilters(principal: Principal, filter: IssueFilterInput): SQL[] {
  const filters: SQL[] = [];
  if (filter.teamId !== undefined) filters.push(eq(schema.issue.teamId, filter.teamId));
  if (filter.projectId !== undefined) filters.push(eq(schema.issue.projectId, filter.projectId));
  if (filter.cycleId !== undefined) filters.push(eq(schema.issue.cycleId, filter.cycleId));
  if (filter.milestoneId !== undefined) {
    filters.push(eq(schema.issue.milestoneId, filter.milestoneId));
  }
  if (filter.assigneeId !== undefined) {
    filters.push(
      filter.assigneeId === UNSET_FILTER_VALUE
        ? isNull(schema.issue.assigneeId)
        : eq(schema.issue.assigneeId, filter.assigneeId),
    );
  }
  if (filter.stateId !== undefined) filters.push(eq(schema.issue.stateId, filter.stateId));
  if (filter.parentId !== undefined) filters.push(eq(schema.issue.parentId, filter.parentId));
  if (filter.stateCategory !== undefined) {
    filters.push(
      inArray(
        schema.issue.stateId,
        db
          .select({ id: schema.workflowState.id })
          .from(schema.workflowState)
          .where(
            and(
              eq(schema.workflowState.organizationId, principal.organizationId),
              eq(schema.workflowState.category, filter.stateCategory),
            ),
          ),
      ),
    );
  }
  if (filter.labelId !== undefined) {
    filters.push(
      inArray(
        schema.issue.id,
        db
          .select({ id: schema.issueLabel.issueId })
          .from(schema.issueLabel)
          .where(eq(schema.issueLabel.labelId, filter.labelId)),
      ),
    );
  }
  if (filter.query !== undefined && filter.query.trim().length > 0) {
    const term = `%${filter.query.trim()}%`;
    const matches = or(
      ilike(schema.issue.title, term),
      ilike(schema.issue.description, term),
      ilike(schema.issue.identifier, term),
    );
    if (matches !== undefined) filters.push(matches);
  }
  if (!filter.includeArchived) filters.push(isNull(schema.issue.archivedAt));
  if (!filter.includeSubIssues && filter.parentId === undefined) {
    filters.push(isNull(schema.issue.parentId));
  }
  return filters;
}

export function buildIssueWhere(principal: Principal, input: IssueWhereInput): SQL<unknown> {
  const filters = [
    eq(schema.issue.organizationId, principal.organizationId),
    ...visibilityFilters(principal, input.visibility),
    ...directFilters(principal, input.filter),
    ...(input.advancedFilter === 'omit'
      ? []
      : buildFilterFilters(input.filter.filter, {
          now: input.now,
          ...(input.calendar === undefined ? {} : { calendar: input.calendar }),
        })),
  ];
  return and(...filters) ?? sql`false`;
}
