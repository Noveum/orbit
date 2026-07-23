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
