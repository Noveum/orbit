import type { NotificationType } from '@orbit/shared/constants';

export interface NotificationGroup {
  readonly title: string;
  readonly types: readonly NotificationType[];
}

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  issue_assigned: 'Issue assigned',
  issue_unassigned: 'Issue unassigned',
  issue_status_changed: 'Status changed',
  issue_priority_changed: 'Priority changed',
  triage_added: 'Added to triage',
  mention: 'Mention',
  comment_created: 'New comment',
  comment_replied: 'Reply to your comment',
  reaction: 'Reaction',
  document_changed: 'Document changed',
  doc_access_requested: 'Document access requested',
  doc_access_granted: 'Document access granted',
  project_update: 'Project update',
  reminder_due: 'Reminder due',
  subscription_activity: 'Activity you follow',
  invite_accepted: 'Invite accepted',
  member_joined: 'Member joined',
  pr_review_requested: 'Review requested',
  pr_comment: 'Pull request comment',
  pr_review_submitted: 'Review submitted',
  pr_approved: 'Pull request approved',
  pr_merged: 'Pull request merged',
  pr_closed: 'Pull request closed',
  pr_checks_failed: 'Checks failed',
};

export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = [
  {
    title: 'Issues',
    types: [
      'issue_assigned',
      'issue_unassigned',
      'issue_status_changed',
      'issue_priority_changed',
      'triage_added',
    ],
  },
  {
    title: 'Comments and mentions',
    types: ['mention', 'comment_created', 'comment_replied', 'reaction'],
  },
  {
    title: 'Documents',
    types: ['document_changed', 'doc_access_requested', 'doc_access_granted'],
  },
  {
    title: 'Projects and reminders',
    types: ['project_update', 'reminder_due', 'subscription_activity'],
  },
  {
    title: 'Workspace',
    types: ['invite_accepted', 'member_joined'],
  },
  {
    title: 'Pull requests',
    types: [
      'pr_review_requested',
      'pr_comment',
      'pr_review_submitted',
      'pr_approved',
      'pr_merged',
      'pr_closed',
      'pr_checks_failed',
    ],
  },
];
