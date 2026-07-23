import { GROUP_BY_FIELDS, VIEW_LAYOUTS } from '@orbit/shared/filters';
import { issueFilterSchema } from '@orbit/shared/validators';
import { z } from 'zod';

const timestamp = z.string();
const nullableTimestamp = z.string().nullable();

export const issueSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  teamId: z.string(),
  number: z.number(),
  identifier: z.string(),
  title: z.string(),
  description: z.string(),
  stateId: z.string(),
  priority: z.number(),
  creatorId: z.string(),
  assigneeId: z.string().nullable(),
  projectId: z.string().nullable(),
  milestoneId: z.string().nullable(),
  cycleId: z.string().nullable(),
  parentId: z.string().nullable(),
  estimate: z.number().nullable(),
  dueDate: z.string().nullable(),
  sortOrder: z.number(),
  startedAt: nullableTimestamp,
  completedAt: nullableTimestamp,
  canceledAt: nullableTimestamp,
  stateEnteredAt: timestamp,
  syncId: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: nullableTimestamp,
  labelIds: z.array(z.string()).default([]),
});

export type Issue = z.infer<typeof issueSchema>;

export const workflowStateSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  category: z.string(),
  color: z.string(),
  position: z.number(),
});

export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const labelSchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
  name: z.string(),
  color: z.string(),
});

export type Label = z.infer<typeof labelSchema>;

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  icon: z.string(),
  color: z.string(),
});

export type Team = z.infer<typeof teamSchema>;

export const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  handle: z.string().nullable(),
  role: z.string(),
});

export type Member = z.infer<typeof memberSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  color: z.string(),
  icon: z.string(),
});

export type Project = z.infer<typeof projectSchema>;

export const cycleSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  number: z.number(),
  name: z.string(),
  startsAt: timestamp,
  endsAt: timestamp,
  completedAt: nullableTimestamp,
});

export type Cycle = z.infer<typeof cycleSchema>;

export const activitySchema = z.object({
  id: z.string(),
  issueId: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  field: z.string(),
  summary: z.string(),
  createdAt: timestamp,
});

export type Activity = z.infer<typeof activitySchema>;

export const reactionSchema = z.object({
  id: z.string(),
  commentId: z.string().nullable(),
  userId: z.string(),
  emoji: z.string(),
});

export type Reaction = z.infer<typeof reactionSchema>;

export const commentSchema = z.object({
  comment: z.object({
    id: z.string(),
    issueId: z.string(),
    authorId: z.string(),
    parentId: z.string().nullable(),
    body: z.string(),
    editedAt: nullableTimestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: nullableTimestamp,
    syncId: z.number(),
  }),
  bodyHtml: z.string(),
  reactions: z.array(reactionSchema).default([]),
});

export type Comment = z.infer<typeof commentSchema>;

export const bootstrapSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  role: z.string(),
  teams: z.array(teamSchema),
  activeTeamId: z.string().nullable(),
  states: z.array(workflowStateSchema),
  labels: z.array(labelSchema),
  members: z.array(memberSchema),
  projects: z.array(projectSchema),
  cycles: z.array(cycleSchema),
  issues: z.array(issueSchema),
});

export type Bootstrap = z.infer<typeof bootstrapSchema>;

export const issueListSchema = z.object({
  issues: z.array(issueSchema),
  nextCursor: z.string().nullable(),
});

export const issueEnvelopeSchema = z.object({ issue: issueSchema });

export const issueMoveResultSchema = z.object({
  issue: issueSchema,
  rebalanced: z.array(issueSchema),
});

export const issueDetailSchema = z.object({
  issue: issueSchema,
  descriptionHtml: z.string(),
  activity: z.array(activitySchema),
  subIssues: z.array(issueSchema),
  subscribed: z.boolean(),
});

export type IssueDetail = z.infer<typeof issueDetailSchema>;

export const docSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  collectionId: z.string().nullable(),
  projectId: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  visibility: z.string(),
  publishToken: z.string().nullable(),
  authorId: z.string(),
  repoBinding: z
    .object({ repo: z.string(), path: z.string(), branch: z.string(), syncedAt: z.string() })
    .nullable(),
  syncId: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: nullableTimestamp,
});

export type Doc = z.infer<typeof docSchema>;

export const docSummarySchema = docSchema.extend({ excerpt: z.string().default('') });
export type DocSummary = z.infer<typeof docSummarySchema>;

export const docCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
});

export type DocCollection = z.infer<typeof docCollectionSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  parentType: z.string(),
  parentId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  size: z.number(),
  storageKey: z.string(),
  status: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const docListSchema = z.object({
  docs: z.array(docSummarySchema),
  collections: z.array(docCollectionSchema),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type DocList = z.infer<typeof docListSchema>;

export const docDetailSchema = z.object({
  doc: docSchema,
  contentHtml: z.string(),
  attachments: z.array(attachmentSchema),
  author: z.object({ id: z.string(), name: z.string(), image: z.string().nullable() }),
  followers: z.number(),
});

export type DocDetail = z.infer<typeof docDetailSchema>;

export const docEnvelopeSchema = z.object({ doc: docSchema });
export const docSaveResultSchema = z.object({ doc: docSchema, contentHtml: z.string() });
export const docArchiveResultSchema = z.object({ doc: docSchema, archived: z.boolean() });
export const docShareResultSchema = z.object({
  doc: docSchema,
  publishUrl: z.string().nullable(),
});
export const docCollectionEnvelopeSchema = z.object({ collection: docCollectionSchema });
export const viewSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  filter: issueFilterSchema.partial().catch({}),
  layout: z.enum(VIEW_LAYOUTS).catch('list'),
  groupBy: z.enum(GROUP_BY_FIELDS).catch('state'),
  shared: z.boolean(),
  createdAt: timestamp,
});

export type View = z.infer<typeof viewSchema>;

export const viewListSchema = z.object({ views: z.array(viewSchema) });
export const viewEnvelopeSchema = z.object({ view: viewSchema });

export const commentListSchema = z.object({ comments: z.array(commentSchema) });
export const commentEnvelopeSchema = z.object({ comment: commentSchema });
export const reactionResultSchema = z.object({ emoji: z.string(), active: z.boolean() });
export const deletedSchema = z.object({ deleted: z.boolean() });
export const subscribedSchema = z.object({ subscribed: z.boolean() });
