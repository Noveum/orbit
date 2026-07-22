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

export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

export const ORG_ROLES = ['admin', 'member', 'contributor', 'guest'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  admin: 3,
  member: 2,
  contributor: 1,
  guest: 0,
};

export const PROJECT_HEALTHS = ['on_track', 'at_risk', 'off_track', 'no_update'] as const;
export type ProjectHealth = (typeof PROJECT_HEALTHS)[number];

export const PROJECT_STATUSES = [
  'backlog',
  'planned',
  'in_progress',
  'completed',
  'canceled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ISSUE_RELATION_TYPES = ['blocks', 'blocked_by', 'related', 'duplicate_of'] as const;
export type IssueRelationType = (typeof ISSUE_RELATION_TYPES)[number];

export const DOC_VISIBILITIES = ['workspace', 'link', 'public'] as const;
export type DocVisibility = (typeof DOC_VISIBILITIES)[number];

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

export const ACTOR_TYPES = ['user', 'integration', 'agent', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const SORT_ORDER_STEP = 1024;

export const DEFAULT_ESTIMATE_SCALE = [0, 1, 2, 3, 5, 8, 13] as const;

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'text/',
  'application/pdf',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument',
  'application/msword',
  'application/vnd.ms-excel',
] as const;

export const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
