import { z } from 'zod';

const timestamp = z.string();
const nullableTimestamp = z.string().nullable();

export const issueActorSchema = z.object({
  type: z.enum(['user', 'agent']),
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  deleted: z.boolean(),
});

export type IssueActor = z.infer<typeof issueActorSchema>;

export const issueSchema = z.object({
  canOpen: z.boolean().optional(),
  id: z.string(),
  organizationId: z.string().default(''),
  teamId: z.string(),
  number: z.number(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().default(''),
  stateId: z.string(),
  priority: z.number(),
  creatorId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  creatorUserId: z.string().nullable().optional(),
  creatorAgentId: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeAgentId: z.string().nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
  creator: issueActorSchema.nullable().optional(),
  assignee: issueActorSchema.nullable().optional(),
  owner: issueActorSchema.nullable().optional(),
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

export const workflowStateSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  category: z.string(),
  color: z.string(),
  position: z.number(),
});

export const projectSchema = z.object({
  id: z.string(),
  slug: z.string().catch(''),
  name: z.string(),
  status: z.string(),
  color: z.string(),
  icon: z.string(),
  teamIds: z.array(z.string()).catch([]).default([]),
});

export const standupMetadataSchema = z.object({
  states: z.array(workflowStateSchema),
  projects: z.array(projectSchema),
});
