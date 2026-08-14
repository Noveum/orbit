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
  'doc_access_requested',
  'doc_access_granted',
  'project_update',
  'reminder_due',
  'triage_added',
  'invite_accepted',
  'member_joined',
  'pr_review_requested',
  'pr_comment',
  'pr_review_submitted',
  'pr_approved',
  'pr_merged',
  'pr_closed',
  'pr_checks_failed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const PULL_REQUEST_NOTIFICATION_TYPES = [
  'pr_review_requested',
  'pr_comment',
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

export const NOTIFICATION_REASONS = [
  'assigned',
  'mentioned',
  'subscribed',
  'commented',
  'state_changed',
  'review_requested',
  'review_approved',
  'pull_request_merged',
  'due_soon',
  'access_requested',
  'access_granted',
  'manual',
] as const;
export type NotificationReason = (typeof NOTIFICATION_REASONS)[number];
