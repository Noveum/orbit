import {
  and,
  db,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  schema,
  sql,
} from '@orbit/db';
import type {
  DateProperty,
  FilterCondition,
  FilterGroup,
  FilterNode,
  RelativeDate,
} from '@orbit/shared/filters';
import { NAMED_DATE_VALUES, resolveRelativeRange, UNSET_FILTER_VALUE } from '@orbit/shared/filters';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { addUtcDays } from '../internal.ts';

export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(day: string, count: number): string {
  return today(addUtcDays(new Date(`${day}T00:00:00Z`), count));
}

export interface FilterContext {
  readonly now: Date;
  readonly calendar?: {
    readonly today: string;
    readonly startOfDay: (day: string) => Date;
  };
}

function anyOf(clauses: readonly SQL[]): SQL | null {
  const first = clauses[0];
  if (first === undefined) return null;
  return clauses.length === 1 ? first : (or(...clauses) ?? first);
}

function allOf(clauses: readonly SQL[]): SQL | null {
  const first = clauses[0];
  if (first === undefined) return null;
  return clauses.length === 1 ? first : (and(...clauses) ?? first);
}

function negateWithNulls(condition: SQL, column: AnyColumn, matchesUnset: boolean): SQL {
  if (matchesUnset) return not(condition);
  return or(not(condition), isNull(column)) ?? not(condition);
}

function setPredicate(column: AnyColumn, values: readonly string[], negate: boolean): SQL | null {
  const ids = values.filter((value) => value !== UNSET_FILTER_VALUE);
  const matchesUnset = ids.length !== values.length;

  const parts: SQL[] = [];
  if (ids.length > 0) parts.push(inArray(column, ids));
  if (matchesUnset) parts.push(isNull(column));

  const positive = anyOf(parts);
  if (positive === null) return null;
  return negate ? negateWithNulls(positive, column, matchesUnset) : positive;
}

function numberSetPredicate(
  column: AnyColumn,
  values: readonly string[],
  negate: boolean,
): SQL | null {
  const numbers = values.map(Number).filter((value) => Number.isInteger(value));
  const matchesUnset = values.includes(UNSET_FILTER_VALUE);

  const parts: SQL[] = [];
  if (numbers.length > 0) parts.push(inArray(column, numbers));
  if (matchesUnset) parts.push(isNull(column));

  const positive = anyOf(parts);
  if (positive === null) return null;
  return negate ? negateWithNulls(positive, column, matchesUnset) : positive;
}

function membershipPredicate(
  values: readonly string[],
  negate: boolean,
  all: SQL,
  matching: (ids: readonly string[]) => SQL,
): SQL | null {
  if (values.length === 0) return null;
  const ids = values.filter((value) => value !== UNSET_FILTER_VALUE);
  const matchesUnset = ids.length !== values.length;

  const parts: SQL[] = [];
  if (ids.length > 0) parts.push(matching(ids));
  if (matchesUnset) parts.push(not(all));

  const positive = anyOf(parts);
  if (positive === null) return null;
  return negate ? not(positive) : positive;
}

function labelPredicate(values: readonly string[], negate: boolean): SQL | null {
  return membershipPredicate(
    values,
    negate,
    inArray(schema.issue.id, db.select({ id: schema.issueLabel.issueId }).from(schema.issueLabel)),
    (ids) =>
      inArray(
        schema.issue.id,
        db
          .select({ id: schema.issueLabel.issueId })
          .from(schema.issueLabel)
          .where(inArray(schema.issueLabel.labelId, [...ids])),
      ),
  );
}

function subscriberPredicate(values: readonly string[], negate: boolean): SQL | null {
  return membershipPredicate(
    values,
    negate,
    inArray(
      schema.issue.id,
      db.select({ id: schema.issueSubscription.issueId }).from(schema.issueSubscription),
    ),
    (ids) =>
      inArray(
        schema.issue.id,
        db
          .select({ id: schema.issueSubscription.issueId })
          .from(schema.issueSubscription)
          .where(inArray(schema.issueSubscription.userId, [...ids])),
      ),
  );
}

function hasAttachment(): SQL {
  return inArray(
    schema.issue.id,
    db
      .select({ id: schema.attachment.parentId })
      .from(schema.attachment)
      .where(eq(schema.attachment.parentType, 'issue')),
  );
}

function presencePredicate(values: readonly string[], negate: boolean, present: SQL): SQL | null {
  const wantsAny = values.includes('any');
  const wantsNone = values.includes(UNSET_FILTER_VALUE);
  if (wantsAny === wantsNone) return null;
  const positive = wantsAny ? present : not(present);
  return negate ? not(positive) : positive;
}

function milestonePredicate(values: readonly string[], negate: boolean): SQL | null {
  const ids = values.filter((value) => value !== UNSET_FILTER_VALUE && value !== 'any');
  if (ids.length > 0) return setPredicate(schema.issue.milestoneId, values, negate);
  return presencePredicate(values, negate, isNotNull(schema.issue.milestoneId));
}

function relationOfType(types: readonly string[]): SQL {
  return inArray(
    schema.issue.id,
    db
      .select({ id: schema.issueRelation.issueId })
      .from(schema.issueRelation)
      .where(inArray(schema.issueRelation.type, [...types])),
  );
}

const ALL_RELATION_TYPES = ['blocked_by', 'blocks', 'related', 'duplicate_of'] as const;

function hasChildren(): SQL {
  return inArray(
    schema.issue.id,
    db
      .select({ id: schema.issue.parentId })
      .from(schema.issue)
      .where(isNotNull(schema.issue.parentId)),
  );
}

function relationClause(value: string): SQL | null {
  switch (value) {
    case 'parent':
      return hasChildren();
    case 'sub_issue':
      return isNotNull(schema.issue.parentId);
    case 'blocked':
      return relationOfType(['blocked_by']);
    case 'blocking':
      return relationOfType(['blocks']);
    case 'related':
      return relationOfType(['related']);
    case 'duplicate':
      return relationOfType(['duplicate_of']);
    case UNSET_FILTER_VALUE:
      return allOf([
        isNull(schema.issue.parentId),
        not(hasChildren()),
        not(relationOfType(ALL_RELATION_TYPES)),
      ]);
    default:
      return null;
  }
}

function relationPredicate(values: readonly string[], negate: boolean): SQL | null {
  const positive = anyOf(
    values.flatMap((value) => {
      const clause = relationClause(value);
      return clause === null ? [] : [clause];
    }),
  );
  if (positive === null) return null;
  return negate ? not(positive) : positive;
}

function contentPredicate(value: string, negate: boolean): SQL | null {
  const term = `%${value.trim()}%`;
  const positive = or(
    ilike(schema.issue.title, term),
    ilike(schema.issue.description, term),
    ilike(schema.issue.identifier, term),
  );
  if (positive === undefined) return null;
  return negate ? not(positive) : positive;
}

const DATE_COLUMNS: Record<DateProperty, AnyColumn> = {
  due: schema.issue.dueDate,
  created: schema.issue.createdAt,
  updated: schema.issue.updatedAt,
  started: schema.issue.startedAt,
  completed: schema.issue.completedAt,
  stateAge: schema.issue.stateEnteredAt,
};

function dayBounds(
  property: DateProperty,
  from: string | null,
  to: string | null,
  context: FilterContext,
): SQL | null {
  const column = DATE_COLUMNS[property];
  const parts: SQL[] = [];
  if (property === 'due' || context.calendar === undefined) {
    if (from !== null) parts.push(sql`${column}::date >= ${from}::date`);
    if (to !== null) parts.push(sql`${column}::date <= ${to}::date`);
    return allOf(parts);
  }
  if (from !== null) {
    parts.push(sql`${column} >= ${context.calendar.startOfDay(from).toISOString()}::timestamptz`);
  }
  if (to !== null) {
    parts.push(
      sql`${column} < ${context.calendar.startOfDay(addDays(to, 1)).toISOString()}::timestamptz`,
    );
  }
  return allOf(parts);
}

function namedDateClause(
  property: DateProperty,
  value: string,
  context: FilterContext,
): SQL | null {
  const column = DATE_COLUMNS[property];
  const currentDay = context.calendar?.today ?? today(context.now);
  switch (value) {
    case UNSET_FILTER_VALUE:
      return isNull(column);
    case 'any':
      return isNotNull(column);
    case 'overdue':
      return dayBounds(property, null, addDays(currentDay, -1), context);
    case 'today':
      return dayBounds(property, currentDay, currentDay, context);
    case 'this_week':
      return dayBounds(property, currentDay, addDays(currentDay, 7), context);
    default:
      return null;
  }
}

function datePredicate(
  property: DateProperty,
  values: readonly string[],
  negate: boolean,
  context: FilterContext,
): SQL | null {
  const positive = anyOf(
    values.flatMap((value) => {
      if (!NAMED_DATE_VALUES.some((entry) => entry === value)) return [];
      const clause = namedDateClause(property, value, context);
      return clause === null ? [] : [clause];
    }),
  );
  if (positive === null) return null;
  const matchesUnset = values.includes(UNSET_FILTER_VALUE);
  return negate ? negateWithNulls(positive, DATE_COLUMNS[property], matchesUnset) : positive;
}

function relativeDatePredicate(
  property: DateProperty,
  relative: RelativeDate,
  negate: boolean,
  context: FilterContext,
): SQL | null {
  const range = resolveRelativeRange(relative, context.calendar?.today ?? today(context.now));
  const positive = dayBounds(property, range.from, range.to, context);
  if (positive === null) return null;
  return negate ? negateWithNulls(positive, DATE_COLUMNS[property], false) : positive;
}

function isDate(property: FilterCondition['property']): property is DateProperty {
  return property in DATE_COLUMNS;
}

function numericRange(column: AnyColumn, from: string | null, to: string | null): SQL | null {
  const parts: SQL[] = [];
  if (from !== null && Number.isInteger(Number(from))) parts.push(gte(column, Number(from)));
  if (to !== null && Number.isInteger(Number(to))) parts.push(lte(column, Number(to)));
  return allOf(parts);
}

function rangeSql(condition: FilterCondition, context: FilterContext): SQL | null {
  if (condition.operator !== 'range') return null;
  const { property, negate, from, to } = condition;
  if (isDate(property)) {
    const positive = dayBounds(property, from, to, context);
    if (positive === null) return null;
    return negate ? negateWithNulls(positive, DATE_COLUMNS[property], false) : positive;
  }
  if (property !== 'priority' && property !== 'estimate') return null;
  const column = property === 'priority' ? schema.issue.priority : schema.issue.estimate;
  const positive = numericRange(column, from, to);
  if (positive === null) return null;
  return negate ? negateWithNulls(positive, column, false) : positive;
}

function setSql(condition: FilterCondition, context: FilterContext): SQL | null {
  if (condition.operator !== 'in') return null;
  const { property, negate, values } = condition;
  switch (property) {
    case 'state':
      return setPredicate(schema.issue.stateId, values, negate);
    case 'assignee':
      return setPredicate(schema.issue.assigneeId, values, negate);
    case 'creator':
      return setPredicate(schema.issue.creatorId, values, negate);
    case 'project':
      return setPredicate(schema.issue.projectId, values, negate);
    case 'cycle':
      return setPredicate(schema.issue.cycleId, values, negate);
    case 'priority':
      return numberSetPredicate(schema.issue.priority, values, negate);
    case 'estimate':
      return numberSetPredicate(schema.issue.estimate, values, negate);
    case 'label':
      return labelPredicate(values, negate);
    case 'subscriber':
      return subscriberPredicate(values, negate);
    case 'link':
      return presencePredicate(values, negate, hasAttachment());
    case 'milestone':
      return milestonePredicate(values, negate);
    case 'relation':
      return relationPredicate(values, negate);
    case 'content':
      return null;
    default:
      return isDate(property) ? datePredicate(property, values, negate, context) : null;
  }
}

function conditionSql(condition: FilterCondition, context: FilterContext): SQL | null {
  if (condition.operator === 'exact') {
    return condition.property === 'content'
      ? contentPredicate(condition.value, condition.negate)
      : null;
  }
  if (condition.operator === 'relative') {
    return isDate(condition.property)
      ? relativeDatePredicate(condition.property, condition.relative, condition.negate, context)
      : null;
  }
  if (condition.operator === 'range') return rangeSql(condition, context);
  return setSql(condition, context);
}

export function buildFilterSql(node: FilterNode, context: FilterContext): SQL | null {
  if (node.kind === 'condition') return conditionSql(node, context);

  const parts = node.children.flatMap((child) => {
    const clause = buildFilterSql(child, context);
    return clause === null ? [] : [clause];
  });
  if (parts.length <= 1) return parts[0] ?? null;
  return (node.combinator === 'or' ? or(...parts) : and(...parts)) ?? null;
}

export function buildFilterFilters(group: FilterGroup, context: FilterContext): SQL[] {
  const clause = buildFilterSql(group, context);
  return clause === null ? [] : [clause];
}
