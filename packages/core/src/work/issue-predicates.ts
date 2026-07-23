import { and, db, gte, inArray, isNull, lt, lte, not, or, schema } from '@orbit/db';
import type { DueFilterValue, FilterPredicate } from '@orbit/shared/filters';
import { UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { addUtcDays } from '../internal.ts';

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(day: string, count: number): string {
  return today(addUtcDays(new Date(`${day}T00:00:00Z`), count));
}

function widenForNulls(condition: SQL, column: AnyColumn, matchesUnset: boolean): SQL {
  if (matchesUnset) return not(condition);
  return or(not(condition), isNull(column)) ?? not(condition);
}

function columnPredicate(
  column: AnyColumn,
  values: readonly string[],
  negated: boolean,
): SQL | null {
  const ids = values.filter((value) => value !== UNSET_FILTER_VALUE);
  const matchesUnset = ids.length !== values.length;

  const parts: SQL[] = [];
  if (ids.length > 0) parts.push(inArray(column, ids));
  if (matchesUnset) parts.push(isNull(column));

  const first = parts[0];
  if (first === undefined) return null;
  const positive = parts.length === 1 ? first : (or(...parts) ?? first);
  return negated ? widenForNulls(positive, column, matchesUnset) : positive;
}

function priorityPredicate(values: readonly string[], negated: boolean): SQL | null {
  const numbers = values.map(Number).filter((value) => Number.isInteger(value));
  if (numbers.length === 0) return null;
  const positive = inArray(schema.issue.priority, numbers);
  return negated ? not(positive) : positive;
}

function labelPredicate(values: readonly string[], negated: boolean): SQL | null {
  const ids = values.filter((value) => value !== UNSET_FILTER_VALUE);
  const labelled = inArray(
    schema.issue.id,
    db.select({ id: schema.issueLabel.issueId }).from(schema.issueLabel),
  );

  if (values.length === 0) return null;
  if (ids.length === 0) return negated ? labelled : not(labelled);

  const positive = inArray(
    schema.issue.id,
    db
      .select({ id: schema.issueLabel.issueId })
      .from(schema.issueLabel)
      .where(inArray(schema.issueLabel.labelId, ids)),
  );
  return negated ? not(positive) : positive;
}

function dueClause(value: DueFilterValue, today: string): SQL | null {
  const column = schema.issue.dueDate;
  if (value === 'none') return isNull(column);
  if (value === 'overdue') return lt(column, today);
  return and(gte(column, today), lte(column, addDays(today, 7))) ?? null;
}

function duePredicate(values: readonly string[], negated: boolean, today: string): SQL | null {
  const clauses: SQL[] = [];
  let matchesUnset = false;
  for (const value of values) {
    if (value !== 'none' && value !== 'overdue' && value !== 'this_week') continue;
    if (value === 'none') matchesUnset = true;
    const clause = dueClause(value, today);
    if (clause !== null) clauses.push(clause);
  }

  const first = clauses[0];
  if (first === undefined) return null;
  const positive = clauses.length === 1 ? first : (or(...clauses) ?? first);
  return negated ? widenForNulls(positive, schema.issue.dueDate, matchesUnset) : positive;
}

export function buildPredicateFilters(
  predicates: readonly FilterPredicate[],
  today: string,
): SQL[] {
  const filters: SQL[] = [];
  for (const predicate of predicates) {
    const negated = predicate.operator === 'is_not';
    const clause = predicateClause(predicate, negated, today);
    if (clause !== null) filters.push(clause);
  }
  return filters;
}

function predicateClause(predicate: FilterPredicate, negated: boolean, today: string): SQL | null {
  switch (predicate.field) {
    case 'state':
      return columnPredicate(schema.issue.stateId, predicate.values, negated);
    case 'assignee':
      return columnPredicate(schema.issue.assigneeId, predicate.values, negated);
    case 'creator':
      return columnPredicate(schema.issue.creatorId, predicate.values, negated);
    case 'project':
      return columnPredicate(schema.issue.projectId, predicate.values, negated);
    case 'cycle':
      return columnPredicate(schema.issue.cycleId, predicate.values, negated);
    case 'priority':
      return priorityPredicate(predicate.values, negated);
    case 'label':
      return labelPredicate(predicate.values, negated);
    case 'due':
      return duePredicate(predicate.values, negated, today);
  }
}
