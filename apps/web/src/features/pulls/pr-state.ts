export type PrBadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export const PR_STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'In review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  merged: 'Merged',
  closed: 'Closed',
};

export const PR_STATE_TONE: Record<string, PrBadgeTone> = {
  draft: 'neutral',
  open: 'accent',
  approved: 'success',
  changes_requested: 'warning',
  merged: 'accent',
  closed: 'danger',
};

export const PR_GROUP_ORDER: readonly string[] = [
  'changes_requested',
  'open',
  'approved',
  'draft',
  'merged',
  'closed',
];

export function prStateLabel(state: string): string {
  return PR_STATE_LABEL[state] ?? state;
}

export function prStateTone(state: string): PrBadgeTone {
  return PR_STATE_TONE[state] ?? 'neutral';
}
