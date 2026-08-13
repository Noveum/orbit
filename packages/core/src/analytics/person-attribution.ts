import { schema, sql } from '@orbit/db';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import type { AnalyticsQuery } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';

export const UNASSIGNED_PERSON_ID = 'unassigned';

type AnalyticsFilterNode = AnalyticsQuery['filter']['children'][number];

function withoutAssigneeNode(node: AnalyticsFilterNode): AnalyticsFilterNode | null {
  if (node.kind === 'condition') return node.property === 'assignee' ? null : node;
  const children = node.children.flatMap((child): AnalyticsFilterNode[] => {
    const retained = withoutAssigneeNode(child);
    return retained === null ? [] : [retained];
  });
  if (children.length === 0) return null;
  return { ...node, children };
}

export function withoutAssigneeFilter(query: AnalyticsQuery): AnalyticsQuery {
  const children = query.filter.children.flatMap((child): AnalyticsFilterNode[] => {
    const retained = withoutAssigneeNode(child);
    return retained === null ? [] : [retained];
  });
  return { ...query, filter: { ...query.filter, children } };
}

export function completionAttributionKind(): SQL<unknown> {
  return sql`case
    when exists (
      select 1 from cycle_issue_outcome person_outcome
      where person_outcome.organization_id = ${schema.issue.organizationId}
        and person_outcome.issue_id = ${schema.issue.id}
        and person_outcome.outcome = 'completed'
        and person_outcome.completed_at is not distinct from ${schema.issue.completedAt}
    ) then 'captured'
    when exists (
      select 1 from issue_activity person_assignment_history
      where person_assignment_history.issue_id = ${schema.issue.id}
        and person_assignment_history.field = 'assigneeId'
    ) then 'reconstructed'
    else 'current_assignee'
  end`;
}

export function completionAttributionPerson(): SQL<unknown> {
  return sql`case
    when exists (
      select 1 from cycle_issue_outcome person_outcome
      where person_outcome.organization_id = ${schema.issue.organizationId}
        and person_outcome.issue_id = ${schema.issue.id}
        and person_outcome.outcome = 'completed'
        and person_outcome.completed_at is not distinct from ${schema.issue.completedAt}
    ) then (
      select person_outcome.assignee_id_at_close
      from cycle_issue_outcome person_outcome
      where person_outcome.organization_id = ${schema.issue.organizationId}
        and person_outcome.issue_id = ${schema.issue.id}
        and person_outcome.outcome = 'completed'
        and person_outcome.completed_at is not distinct from ${schema.issue.completedAt}
      order by person_outcome.closed_at desc, person_outcome.id desc
      limit 1
    )
    when exists (
      select 1 from issue_activity person_assignment_before
      where person_assignment_before.issue_id = ${schema.issue.id}
        and person_assignment_before.field = 'assigneeId'
        and person_assignment_before.created_at <= ${schema.issue.completedAt}
    ) then (
      select coalesce(
        person_assignment_before.to_value ->> 'id',
        person_assignment_before.to_value #>> '{}'
      )
      from issue_activity person_assignment_before
      where person_assignment_before.issue_id = ${schema.issue.id}
        and person_assignment_before.field = 'assigneeId'
        and person_assignment_before.created_at <= ${schema.issue.completedAt}
      order by person_assignment_before.created_at desc, person_assignment_before.id desc
      limit 1
    )
    when exists (
      select 1 from issue_activity person_assignment_after
      where person_assignment_after.issue_id = ${schema.issue.id}
        and person_assignment_after.field = 'assigneeId'
        and person_assignment_after.created_at > ${schema.issue.completedAt}
    ) then (
      select coalesce(
        person_assignment_after.from_value ->> 'id',
        person_assignment_after.from_value #>> '{}'
      )
      from issue_activity person_assignment_after
      where person_assignment_after.issue_id = ${schema.issue.id}
        and person_assignment_after.field = 'assigneeId'
        and person_assignment_after.created_at > ${schema.issue.completedAt}
      order by person_assignment_after.created_at, person_assignment_after.id
      limit 1
    )
    else ${schema.issue.assigneeId}
  end`;
}

export function personMatches(personId: string, attributed: SQL<unknown>): SQL<unknown> {
  return personId === UNASSIGNED_PERSON_ID
    ? sql`${attributed} is null`
    : sql`${attributed} = ${personId}`;
}

export function selectedAssigneeIds(query: AnalyticsQuery): readonly string[] {
  const selected: string[] = [];
  const visit = (node: AnalyticsFilterNode): void => {
    if (node.kind === 'group') {
      for (const child of node.children) visit(child);
      return;
    }
    if (node.property !== 'assignee' || node.operator !== 'in' || node.negate) return;
    selected.push(
      ...node.values.map((value) => (value === UNSET_FILTER_VALUE ? UNASSIGNED_PERSON_ID : value)),
    );
  };
  for (const child of query.filter.children) visit(child);
  return [...new Set(selected)];
}
