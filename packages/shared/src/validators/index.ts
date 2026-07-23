import { z } from 'zod';
import {
  ALLOWED_UPLOAD_MIME_PREFIXES,
  DOC_VISIBILITIES,
  IDENTIFIER_PATTERN,
  ISSUE_RELATION_TYPES,
  MAX_UPLOAD_BYTES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  ORG_ROLES,
  PRIORITIES,
  PROJECT_HEALTHS,
  PROJECT_STATUSES,
  SLUG_PATTERN,
  STATE_CATEGORIES,
} from '../constants/index.ts';

export const idSchema = z.string().min(1).max(64);
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(SLUG_PATTERN, 'Use lowercase and dashes.');
export const emailSchema = z.string().email().max(254).toLowerCase();
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #5A63C8.');
export const markdownSchema = z.string().max(100_000);
export const titleSchema = z.string().trim().min(1, 'Give it a title.').max(255);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(256).optional(),
});

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(39)
  .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and dashes.');

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    handle: handleSchema,
    image: z.string().url().max(2048).nullable(),
    timezone: z.string().trim().min(1).max(64),
  })
  .partial();

export const organizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(64),
  slug: slugSchema,
});

export const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(64),
    logo: z.string().url().max(2048).nullable(),
    allowedEmailDomains: z.array(z.string().trim().toLowerCase().max(255)).max(20),
  })
  .partial();

export const inviteCreateSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).default('member'),
  teamIds: z.array(idSchema).max(50).default([]),
});

export const inviteBulkSchema = z.object({
  invites: z.array(inviteCreateSchema).min(1).max(100),
});

export const memberUpdateSchema = z.object({
  role: z.enum(ORG_ROLES),
});

export const teamCreateSchema = z.object({
  name: z.string().trim().min(2).max(64),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IDENTIFIER_PATTERN, 'Use 2 to 6 uppercase letters or digits.'),
  description: z.string().max(1000).optional(),
  icon: z.string().max(32).optional(),
  color: colorSchema.optional(),
});

export const teamUpdateSchema = teamCreateSchema.partial().omit({ key: true });

export const teamMemberSchema = z.object({
  userId: idSchema,
});

export const workflowStateCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(48),
  category: z.enum(STATE_CATEGORIES),
  color: colorSchema,
  position: z.number().int().min(0).max(10_000).optional(),
});

export const workflowStateUpdateSchema = workflowStateCreateSchema.partial().omit({ teamId: true });

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(48),
  color: colorSchema,
  teamId: idSchema.nullable().default(null),
});

export const labelUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(48),
    color: colorSchema,
    teamId: idSchema.nullable(),
  })
  .partial();

export const prioritySchema = z
  .number()
  .int()
  .refine((value): value is (typeof PRIORITIES)[number] => PRIORITIES.includes(value as 0));

export const issueCreateSchema = z.object({
  teamId: idSchema,
  title: titleSchema,
  description: markdownSchema.default(''),
  stateId: idSchema.optional(),
  priority: prioritySchema.default(0),
  assigneeId: idSchema.nullable().default(null),
  projectId: idSchema.nullable().default(null),
  milestoneId: idSchema.nullable().default(null),
  cycleId: idSchema.nullable().default(null),
  parentId: idSchema.nullable().default(null),
  estimate: z.number().int().min(0).max(100).nullable().default(null),
  dueDate: z.coerce.date().nullable().default(null),
  labelIds: z.array(idSchema).max(50).default([]),
});

export const issueUpdateSchema = z
  .object({
    title: titleSchema,
    description: markdownSchema,
    stateId: idSchema,
    priority: prioritySchema,
    assigneeId: idSchema.nullable(),
    projectId: idSchema.nullable(),
    milestoneId: idSchema.nullable(),
    cycleId: idSchema.nullable(),
    parentId: idSchema.nullable(),
    estimate: z.number().int().min(0).max(100).nullable(),
    dueDate: z.coerce.date().nullable(),
    labelIds: z.array(idSchema).max(50),
    sortOrder: z.number(),
  })
  .partial();

export const issueMoveSchema = z.object({
  stateId: idSchema.optional(),
  teamId: idSchema.optional(),
  beforeId: idSchema.nullable().default(null),
  afterId: idSchema.nullable().default(null),
});

export const issueBulkUpdateSchema = z.object({
  issueIds: z.array(idSchema).min(1).max(200),
  patch: issueUpdateSchema,
});

export const issueFilterSchema = z.object({
  teamId: idSchema.optional(),
  projectId: idSchema.optional(),
  cycleId: idSchema.optional(),
  milestoneId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  stateId: idSchema.optional(),
  stateCategory: z.enum(STATE_CATEGORIES).optional(),
  labelId: idSchema.optional(),
  parentId: idSchema.optional(),
  query: z.string().max(200).optional(),
  includeArchived: z.coerce.boolean().default(false),
  includeSubIssues: z.coerce.boolean().default(true),
  orderBy: z.enum(['manual', 'priority', 'created', 'updated', 'due']).default('manual'),
});

export const issueRelationSchema = z.object({
  relatedIssueId: idSchema,
  type: z.enum(ISSUE_RELATION_TYPES),
});

export const commentCreateSchema = z.object({
  body: markdownSchema.refine((value) => value.trim().length > 0, 'Write something first.'),
  parentId: idSchema.nullable().default(null),
});

export const commentUpdateSchema = z.object({
  body: markdownSchema.refine((value) => value.trim().length > 0, 'Write something first.'),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  summary: z.string().max(500).default(''),
  description: markdownSchema.default(''),
  status: z.enum(PROJECT_STATUSES).default('backlog'),
  health: z.enum(PROJECT_HEALTHS).default('no_update'),
  leadId: idSchema.nullable().default(null),
  startDate: z.coerce.date().nullable().default(null),
  targetDate: z.coerce.date().nullable().default(null),
  teamIds: z.array(idSchema).max(50).default([]),
  icon: z.string().max(32).optional(),
  color: colorSchema.optional(),
});

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    summary: z.string().max(500),
    description: markdownSchema,
    status: z.enum(PROJECT_STATUSES),
    health: z.enum(PROJECT_HEALTHS),
    leadId: idSchema.nullable(),
    startDate: z.coerce.date().nullable(),
    targetDate: z.coerce.date().nullable(),
    teamIds: z.array(idSchema).max(50),
    icon: z.string().max(32),
    color: colorSchema,
  })
  .partial();

export const projectUpdatePostSchema = z.object({
  health: z.enum(PROJECT_HEALTHS),
  body: markdownSchema,
});

export const milestoneCreateSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  targetDate: z.coerce.date().nullable().default(null),
});

export const milestoneUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    targetDate: z.coerce.date().nullable(),
  })
  .partial();

export const cycleCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});

export const cycleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .partial();

export const docCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: markdownSchema.default(''),
  projectId: idSchema.nullable().default(null),
  collectionId: idSchema.nullable().default(null),
  visibility: z.enum(DOC_VISIBILITIES).default('workspace'),
});

export const docUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: markdownSchema,
    projectId: idSchema.nullable(),
    collectionId: idSchema.nullable(),
    visibility: z.enum(DOC_VISIBILITIES),
  })
  .partial();

export const viewCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filter: issueFilterSchema.partial(),
  layout: z.enum(['list', 'board', 'table', 'calendar', 'timeline']).default('list'),
  groupBy: z.enum(['state', 'assignee', 'priority', 'project', 'label', 'cycle', 'none']),
  shared: z.boolean().default(false),
});

export const viewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    filter: issueFilterSchema.partial(),
    layout: z.enum(['list', 'board', 'table', 'calendar', 'timeline']),
    groupBy: z.enum(['state', 'assignee', 'priority', 'project', 'label', 'cycle', 'none']),
    shared: z.boolean(),
  })
  .partial();

export const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (value) => ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => value.startsWith(prefix)),
      'That file type is not supported.',
    ),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  parentType: z.enum(['issue', 'comment', 'doc', 'project']),
  parentId: idSchema,
});

export const bootstrapQuerySchema = z.object({
  team: z
    .string()
    .trim()
    .max(16)
    .transform((value) => value.toUpperCase())
    .optional(),
});

export const devSignInSchema = z.object({ email: emailSchema });

export const issueSubscribeSchema = z.object({ subscribed: z.boolean().default(true) });

export const commentQuerySchema = z.object({ issueId: idSchema });

export const notificationPreferenceSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  type: z.enum(NOTIFICATION_TYPES),
  enabled: z.boolean(),
});

export const notificationPreferencesUpdateSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).min(1).max(200),
  quietHoursEnabled: z.boolean().optional(),
  urgentBypassEnabled: z.boolean().optional(),
});

export const notificationReadSchema = z.object({
  notificationIds: z.array(idSchema).min(1).max(500),
  read: z.boolean(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type IssueCreateInput = z.infer<typeof issueCreateSchema>;
export type IssueUpdateInput = z.infer<typeof issueUpdateSchema>;
export type IssueFilterInput = z.infer<typeof issueFilterSchema>;
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type CycleCreateInput = z.infer<typeof cycleCreateSchema>;
export type DocCreateInput = z.infer<typeof docCreateSchema>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
export type ViewCreateInput = z.infer<typeof viewCreateSchema>;
