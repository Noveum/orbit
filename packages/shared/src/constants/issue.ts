export const ISSUE_DESCRIPTION_MAX_LENGTH = 500_000;
export const ISSUE_REVIEWER_MAX_COUNT = 50;

export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const ISSUE_RELATION_TYPES = [
  'blocks',
  'blocked_by',
  'related',
  'duplicate_of',
  'duplicated_by',
] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];

export const RELATION_LABELS: Record<IssueRelationType, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  related: 'Relates to',
  duplicate_of: 'Duplicate of',
  duplicated_by: 'Duplicated by',
};

function isRelationType(value: string): value is IssueRelationType {
  return (ISSUE_RELATION_TYPES as readonly string[]).includes(value);
}

export function readableRelation(stored: string): string {
  const gap = stored.indexOf(' ');
  const type = gap === -1 ? stored : stored.slice(0, gap);
  if (!isRelationType(type)) return stored;
  return gap === -1 ? RELATION_LABELS[type] : `${RELATION_LABELS[type]}${stored.slice(gap)}`;
}
