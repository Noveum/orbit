import { z } from 'zod';

export const FILTER_FIELDS = [
  'state',
  'assignee',
  'label',
  'priority',
  'project',
  'cycle',
  'creator',
  'due',
] as const;

export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPERATORS = ['is', 'is_not'] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const DUE_FILTER_VALUES = ['overdue', 'this_week', 'none'] as const;

export type DueFilterValue = (typeof DUE_FILTER_VALUES)[number];

export const UNSET_FILTER_VALUE = 'none';

export const GROUP_BY_FIELDS = [
  'state',
  'assignee',
  'priority',
  'project',
  'label',
  'cycle',
  'none',
] as const;

export type GroupByField = (typeof GROUP_BY_FIELDS)[number];

export const VIEW_LAYOUTS = ['list', 'board', 'table', 'calendar', 'timeline'] as const;

export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const ISSUE_ORDERINGS = ['manual', 'priority', 'created', 'updated', 'due'] as const;

export type IssueOrdering = (typeof ISSUE_ORDERINGS)[number];

export const FILTER_FIELD_LABELS: Record<FilterField, string> = {
  state: 'Status',
  assignee: 'Assignee',
  label: 'Label',
  priority: 'Priority',
  project: 'Project',
  cycle: 'Cycle',
  creator: 'Creator',
  due: 'Due date',
};

export const DUE_FILTER_LABELS: Record<DueFilterValue, string> = {
  overdue: 'Overdue',
  this_week: 'This week',
  none: 'No due date',
};

const filterValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Filter values may only contain letters, digits, dashes and underscores.',
  );

export const filterPredicateSchema = z.object({
  field: z.enum(FILTER_FIELDS),
  operator: z.enum(FILTER_OPERATORS).default('is'),
  values: z.array(filterValueSchema).min(1).max(50),
});

export type FilterPredicate = z.infer<typeof filterPredicateSchema>;

const PREDICATE_SEPARATOR = ';';
const PART_SEPARATOR = ':';
const VALUE_SEPARATOR = ',';

export function encodeFilterPredicates(predicates: readonly FilterPredicate[]): string {
  return predicates
    .map(
      (predicate) =>
        `${predicate.field}${PART_SEPARATOR}${predicate.operator}${PART_SEPARATOR}${predicate.values.join(VALUE_SEPARATOR)}`,
    )
    .join(PREDICATE_SEPARATOR);
}

export function decodeFilterPredicates(raw: string): FilterPredicate[] {
  const predicates: FilterPredicate[] = [];
  for (const chunk of raw.split(PREDICATE_SEPARATOR)) {
    if (chunk.trim().length === 0) continue;
    const [field, operator, values] = chunk.split(PART_SEPARATOR);
    const parsed = filterPredicateSchema.safeParse({
      field,
      operator,
      values: (values ?? '').split(VALUE_SEPARATOR).filter((value) => value.length > 0),
    });
    if (parsed.success) predicates.push(parsed.data);
  }
  return predicates;
}

export const filterPredicateListSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? decodeFilterPredicates(value) : value),
    z.array(filterPredicateSchema).max(20),
  )
  .default([]);

export function replacePredicate(
  predicates: readonly FilterPredicate[],
  next: FilterPredicate,
): FilterPredicate[] {
  const index = predicates.findIndex((predicate) => predicate.field === next.field);
  if (index === -1) return [...predicates, next];
  const copy = [...predicates];
  copy[index] = next;
  return copy;
}

export function removePredicate(
  predicates: readonly FilterPredicate[],
  field: FilterField,
): FilterPredicate[] {
  return predicates.filter((predicate) => predicate.field !== field);
}

export function dropLastPredicate(predicates: readonly FilterPredicate[]): FilterPredicate[] {
  return predicates.slice(0, -1);
}
