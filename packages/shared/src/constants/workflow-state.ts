export const STATE_CATEGORIES = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'review',
  'completed',
  'canceled',
] as const;

export type StateCategory = (typeof STATE_CATEGORIES)[number];

export const STATE_CATEGORY_ORDER: Record<StateCategory, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  review: 4,
  completed: 5,
  canceled: 6,
};

export const OPEN_STATE_CATEGORIES: readonly StateCategory[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'review',
];
