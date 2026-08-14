import type { FilterNode } from '@orbit/shared/filters';
import type { AnalyticsQuery } from '@orbit/shared/validators';

function constrainedAssignees(node: FilterNode): ReadonlySet<string> | null {
  if (node.kind === 'condition') {
    if (node.property !== 'assignee' || node.operator !== 'in' || node.negate) return null;
    return new Set(node.values);
  }
  const children = node.children.map(constrainedAssignees);
  if (node.combinator === 'or') {
    if (children.some((child) => child === null)) return null;
    return new Set(children.flatMap((child) => (child === null ? [] : [...child])));
  }
  const known = children.filter((child): child is ReadonlySet<string> => child !== null);
  if (known.length === 0) return null;
  const selected = new Set(known[0]);
  for (const child of known.slice(1)) {
    for (const value of selected) {
      if (!child.has(value)) selected.delete(value);
    }
  }
  return selected;
}

export function selectedAssigneeIds(query: AnalyticsQuery): readonly string[] {
  const selected = constrainedAssignees(query.filter);
  return selected === null ? [] : [...selected];
}

export function usesCurrentPersonDefault(query: AnalyticsQuery): boolean {
  return query.focus.personId === undefined && selectedAssigneeIds(query).length === 0;
}
