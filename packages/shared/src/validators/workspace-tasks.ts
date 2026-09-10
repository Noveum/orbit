import { z } from 'zod';
import { STATE_CATEGORIES } from '../constants/index.ts';
import { idSchema, paginationSchema } from './common.ts';
import { booleanFlag } from './issue.ts';

export const workspaceTasksQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  assigneeId: idSchema.optional(),
  stateCategory: z.enum(STATE_CATEGORIES).optional(),
  includeArchived: booleanFlag(false),
  ...paginationSchema.shape,
});

export const workspaceTaskSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  team: z.string(),
  state: z.string(),
  assignee: z.string().nullable(),
  project: z.string().nullable(),
  priority: z.number(),
  updatedAt: z.string(),
  canOpen: z.boolean(),
});

export const workspaceTasksPageSchema = z.object({
  tasks: z.array(workspaceTaskSchema),
  nextCursor: z.string().nullable(),
});

export type WorkspaceTask = z.infer<typeof workspaceTaskSchema>;
