import { schema, sql } from '@orbit/db';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import type { AnalyticsQuery } from '@orbit/shared/validators';
import type { SQL } from 'drizzle-orm';
import type { ResolvedAnalyticsQuery } from './types.ts';

export const UNASSIGNED_PERSON_ID = 'unassigned';

type AnalyticsFilterNode = AnalyticsQuery['filter']['children'][number];
type SimplifiedNode = AnalyticsFilterNode | boolean;

function assigneeValue(value: string): string {
  return value === UNSET_FILTER_VALUE ? UNASSIGNED_PERSON_ID : value;
}

function simplifyNode(node: AnalyticsFilterNode, personId: string): SimplifiedNode {
  if (node.kind === 'condition') {
    if (node.property !== 'assignee') return node;
    const matches =
      node.operator === 'in' && node.values.some((value) => assigneeValue(value) === personId);
    return node.negate ? !matches : matches;
  }
  const simplified = node.children.map((child) => simplifyNode(child, personId));
  if (node.combinator === 'and') {
    if (simplified.some((child) => child === false)) return false;
    const children = simplified.filter((child): child is AnalyticsFilterNode => child !== true);
    return children.length === 0 ? true : { ...node, children };
  }
  if (simplified.some((child) => child === true)) return true;
  const children = simplified.filter((child): child is AnalyticsFilterNode => child !== false);
  return children.length === 0 ? false : { ...node, children };
}

export function historicalPersonFilter(
  query: ResolvedAnalyticsQuery,
  personId: string,
): { readonly query: ResolvedAnalyticsQuery; readonly matches: boolean };
export function historicalPersonFilter(
  query: AnalyticsQuery,
  personId: string,
): { readonly query: AnalyticsQuery; readonly matches: boolean };
export function historicalPersonFilter(
  query: AnalyticsQuery,
  personId: string,
): { readonly query: AnalyticsQuery; readonly matches: boolean } {
  const simplified = simplifyNode(query.filter, personId);
  if (simplified === false) return { query, matches: false };
  if (simplified === true) {
    return { query: { ...query, filter: { ...query.filter, children: [] } }, matches: true };
  }
  if (simplified.kind === 'group')
    return { query: { ...query, filter: simplified }, matches: true };
  return {
    query: { ...query, filter: { ...query.filter, children: [simplified] } },
    matches: true,
  };
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

function constrainedAssignees(node: AnalyticsFilterNode): ReadonlySet<string> | null {
  if (node.kind === 'condition') {
    if (node.property !== 'assignee' || node.operator !== 'in' || node.negate) return null;
    return new Set(node.values.map(assigneeValue));
  }
  const childSets = node.children.map(constrainedAssignees);
  if (node.combinator === 'or') {
    if (childSets.some((set) => set === null)) return null;
    return new Set(childSets.flatMap((set) => (set === null ? [] : [...set])));
  }
  const known = childSets.filter((set): set is ReadonlySet<string> => set !== null);
  if (known.length === 0) return null;
  const values = new Set(known[0]);
  for (const set of known.slice(1)) {
    for (const value of values) {
      if (!set.has(value)) values.delete(value);
    }
  }
  return values;
}

export function selectedAssigneeIds(query: AnalyticsQuery): readonly string[] {
  const selected = constrainedAssignees(query.filter);
  return selected === null ? [] : [...selected];
}
