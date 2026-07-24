export const STATE_GROUP_LABELS: Record<string, string> = {
  triage: 'Triage',
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  review: 'In review',
  completed: 'Completed',
  canceled: 'Canceled',
};

export const STATE_GROUP_COLOR: Record<string, string> = {
  triage: 'var(--color-state-triage)',
  backlog: 'var(--color-state-backlog)',
  unstarted: 'var(--color-state-unstarted)',
  started: 'var(--color-state-started)',
  review: 'var(--color-state-review)',
  completed: 'var(--color-state-completed)',
  canceled: 'var(--color-state-canceled)',
};

export function stateGroupLabel(key: string): string {
  return STATE_GROUP_LABELS[key] ?? key;
}

export function stateGroupColor(key: string): string {
  return STATE_GROUP_COLOR[key] ?? 'var(--color-muted)';
}

export const STATE_GROUP_ORDER: readonly string[] = [
  'triage',
  'backlog',
  'unstarted',
  'started',
  'review',
  'completed',
  'canceled',
];
