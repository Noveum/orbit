export const NOTIFICATION_TYPES = [
  'issue_assigned',
  'issue_unassigned',
  'issue_status_changed',
  'issue_priority_changed',
  'comment_created',
  'comment_replied',
  'mention',
  'reaction',
  'subscription_activity',
  'document_changed',
  'project_update',
  'reminder_due',
  'triage_added',
  'invite_accepted',
  'member_joined',
  'pr_review_requested',
  'pr_review_submitted',
  'pr_approved',
  'pr_merged',
  'pr_closed',
  'pr_checks_failed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const PULL_REQUEST_NOTIFICATION_TYPES = [
  'pr_review_requested',
  'pr_review_submitted',
  'pr_approved',
  'pr_merged',
  'pr_closed',
  'pr_checks_failed',
] as const satisfies readonly NotificationType[];

export function isPullRequestNotification(type: NotificationType): boolean {
  return (PULL_REQUEST_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

export const NOTIFICATION_CHANNELS = ['inbox', 'email', 'slack', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
