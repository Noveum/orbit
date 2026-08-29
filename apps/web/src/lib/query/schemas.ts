import { DOC_KINDS, ISSUE_RELATION_TYPES } from '@orbit/shared/constants';
import {
  defaultViewState,
  GROUP_BY_FIELDS,
  VIEW_LAYOUTS,
  viewStateSchema,
} from '@orbit/shared/filters';
import { docCommentAnchorSchema } from '@orbit/shared/validators';
import { z } from 'zod';

const timestamp = z.string();
const nullableTimestamp = z.string().nullable();

export const issueSchema = z.object({
  id: z.string(),
  organizationId: z.string().default(''),
  teamId: z.string(),
  number: z.number(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().default(''),
  stateId: z.string(),
  priority: z.number(),
  creatorId: z.string(),
  assigneeId: z.string().nullable(),
  reviewerIds: z.array(z.string()).optional(),
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
  stateEnteredAt: timestamp.default(''),
  syncId: z.number(),
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: nullableTimestamp,
  labelIds: z.array(z.string()).catch([]).default([]),
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
  slug: z.string().catch(''),
  name: z.string(),
  status: z.string(),
  color: z.string(),
  icon: z.string(),
  teamIds: z.array(z.string()).catch([]).default([]),
});

export type Project = z.infer<typeof projectSchema>;

export const cycleSchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
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

export const docCommentSchema = z.object({
  comment: z.object({
    id: z.string(),
    docId: z.string(),
    authorId: z.string(),
    parentId: z.string().nullable(),
    body: z.string(),
    anchor: docCommentAnchorSchema.nullable().default(null),
    editedAt: nullableTimestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: nullableTimestamp,
    syncId: z.number(),
  }),
  bodyHtml: z.string(),
});

export type DocComment = z.infer<typeof docCommentSchema>;

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
  issues: z.array(issueSchema).default([]),
});

export type Bootstrap = z.infer<typeof bootstrapSchema>;

export const issueListSchema = z.object({
  issues: z.array(issueSchema),
  nextCursor: z.string().nullable().default(null),
});

export type IssuePage = z.infer<typeof issueListSchema>;

export const boardGroupSchema = z.object({
  id: z.string(),
  total: z.number(),
  issues: z.array(issueSchema),
  nextCursor: z.string().nullable().default(null),
});

export const boardPageSchema = z.object({
  groups: z.array(boardGroupSchema),
  truncated: z.boolean().default(false),
});

export type BoardPage = z.infer<typeof boardPageSchema>;

export const issueCountsSchema = z.object({
  total: z.number(),
  byState: z.record(z.string(), z.number()),
});

export type IssueCounts = z.infer<typeof issueCountsSchema>;

export const FACET_PROPERTIES = [
  'state',
  'assignee',
  'creator',
  'priority',
  'estimate',
  'label',
  'project',
  'cycle',
  'milestone',
] as const;

export type FacetProperty = (typeof FACET_PROPERTIES)[number];

const facetCounts = z.record(z.string(), z.number()).catch({}).default({});

export const issueSummarySchema = z.object({
  total: z.number(),
  byState: z.record(z.string(), z.number()).catch({}).default({}),
  groupTotals: z.record(z.string(), z.number()).catch({}).default({}),
});

export type IssueSummary = z.infer<typeof issueSummarySchema>;

export const issueFacetsSchema = z.object({
  scopeTotal: z.number(),
  facets: z
    .object({
      state: facetCounts,
      assignee: facetCounts,
      creator: facetCounts,
      priority: facetCounts,
      estimate: facetCounts,
      label: facetCounts,
      project: facetCounts,
      cycle: facetCounts,
      milestone: facetCounts,
    })
    .catch(() => emptyFacets()),
});

export type IssueFacets = z.infer<typeof issueFacetsSchema>;

export function emptyFacets(): IssueFacets['facets'] {
  return {
    state: {},
    assignee: {},
    creator: {},
    priority: {},
    estimate: {},
    label: {},
    project: {},
    cycle: {},
    milestone: {},
  };
}

export const issueEnvelopeSchema = z.object({ issue: issueSchema });

export const issueMoveResultSchema = z.object({
  issue: issueSchema,
  rebalanced: z.array(issueSchema),
});

export const issueDeletedSchema = z.object({
  deleted: z.object({ id: z.string(), identifier: z.string() }),
});

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

export const issueDetailSchema = z.object({
  issue: issueSchema,
  descriptionHtml: z.string(),
  activity: z.array(activitySchema),
  activityCursor: z.string().nullable().default(null),
  subIssues: z.array(issueSchema),
  parent: issueSchema.nullable().default(null),
  subscribed: z.boolean(),
  attachments: z.array(attachmentSchema).default([]),
});

export type IssueDetail = z.infer<typeof issueDetailSchema>;

export const issueRelationSchema = z.object({
  id: z.string(),
  type: z.enum(ISSUE_RELATION_TYPES),
  issue: issueSchema,
});

export type IssueRelation = z.infer<typeof issueRelationSchema>;

export const issueRelationListSchema = z.object({ relations: z.array(issueRelationSchema) });

export const docSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  collectionId: z.string().nullable(),
  projectId: z.string().nullable(),
  parentId: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  kind: z.enum(DOC_KINDS).default('markdown'),
  content: z.string(),
  sortOrder: z.number().default(0),
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

export const docSummarySchema = docSchema.extend({
  excerpt: z.string().default(''),
  snippet: z.string().default(''),
  titleMatch: z.boolean().default(false),
  rank: z.number().default(0),
});
export type DocSummary = z.infer<typeof docSummarySchema>;

export const docHomeEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  collectionId: z.string().nullable(),
  projectId: z.string().nullable(),
  authorId: z.string(),
  updatedAt: timestamp,
});

export type DocHomeEntry = z.infer<typeof docHomeEntrySchema>;

export const docsHomeSchema = z.object({
  recent: z.array(docHomeEntrySchema),
  favorites: z.array(docHomeEntrySchema),
  updated: z.array(docHomeEntrySchema),
});

export type DocsHome = z.infer<typeof docsHomeSchema>;

export const docFavoriteResultSchema = z.object({
  docId: z.string(),
  favorite: z.boolean(),
});

export const docVisitResultSchema = z.object({ docId: z.string() });

export const docCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
});

export type DocCollection = z.infer<typeof docCollectionSchema>;

export type Attachment = z.infer<typeof attachmentSchema>;

export const docListSchema = z.object({
  docs: z.array(docSummarySchema),
  collections: z.array(docCollectionSchema),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type DocList = z.infer<typeof docListSchema>;

export const docAccessLevelSchema = z.enum(['read', 'write']).catch('read');

export const docDetailSchema = z.object({
  doc: docSchema,
  contentHtml: z.string(),
  attachments: z.array(attachmentSchema),
  author: z.object({ id: z.string(), name: z.string(), image: z.string().nullable() }),
  followers: z.number(),
  backlinks: z.array(z.object({ id: z.string(), title: z.string() })).default([]),
  access: docAccessLevelSchema,
  favorite: z.boolean().default(false),
});

export const docVersionSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownedById: z.string(),
  restoredFromId: z.string().nullable(),
  lastSavedAt: timestamp,
});

export type DocVersion = z.infer<typeof docVersionSchema>;
export const docVersionListSchema = z.object({ versions: z.array(docVersionSchema) });

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
  filter: viewStateSchema.catch(defaultViewState()),
  layout: z.enum(VIEW_LAYOUTS).catch('list'),
  groupBy: z.enum(GROUP_BY_FIELDS).catch('state'),
  shared: z.boolean(),
  virtual: z.boolean().catch(false),
  locked: z.boolean().catch(false),
  favorite: z.boolean().catch(false),
  readable: z.boolean().default(true).catch(true),
  createdAt: timestamp,
});

export type View = z.infer<typeof viewSchema>;

export const viewListSchema = z.object({ views: z.array(viewSchema) });
export const viewEnvelopeSchema = z.object({ view: viewSchema });

export const milestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  targetDate: z.string().nullable(),
  sortOrder: z.number(),
  scope: z.number().default(0),
  completed: z.number().default(0),
});

export type Milestone = z.infer<typeof milestoneSchema>;

export const milestoneListSchema = z.object({ milestones: z.array(milestoneSchema) });
export const milestoneEnvelopeSchema = z.object({ milestone: milestoneSchema });

export const commentListSchema = z.object({
  comments: z.array(commentSchema),
  nextCursor: z.string().nullable().default(null),
});
export const commentEnvelopeSchema = z.object({ comment: commentSchema });
export const docCommentListSchema = z.object({
  comments: z.array(docCommentSchema),
  nextCursor: z.string().nullable().default(null),
});
export const docCommentEnvelopeSchema = z.object({ comment: docCommentSchema });
export const reactionResultSchema = z.object({ emoji: z.string(), active: z.boolean() });
export const deletedSchema = z.object({ deleted: z.boolean() });
export const subscribedSchema = z.object({ subscribed: z.boolean() });

export const viewPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        page: z.string(),
        scope: z.string(),
        layout: z.string(),
        display: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
});

export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;
