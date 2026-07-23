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
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['inbox', 'email', 'slack', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
