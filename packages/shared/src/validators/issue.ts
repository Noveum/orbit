import { z } from 'zod';
import { ISSUE_RELATION_TYPES, PRIORITIES, STATE_CATEGORIES } from '../constants/index.ts';
import { filterPredicateListSchema, ISSUE_ORDERINGS } from '../filters/index.ts';
import { idSchema, markdownSchema, titleSchema } from './common.ts';

export function booleanFlag(fallback: boolean) {
  return z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((value) => {
      if (value === undefined) return fallback;
      if (typeof value === 'boolean') return value;
      return value === 'true' || value === '1';
    });
}

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
  includeArchived: booleanFlag(false),
  includeSubIssues: booleanFlag(true),
  orderBy: z.enum(ISSUE_ORDERINGS).default('manual'),
  predicates: filterPredicateListSchema,
});

export const issueRelationSchema = z.object({
  relatedIssueId: idSchema,
  type: z.enum(ISSUE_RELATION_TYPES),
});

export const issueSubscribeSchema = z.object({ subscribed: z.boolean().default(true) });

export type IssueCreateInput = z.infer<typeof issueCreateSchema>;
export type IssueUpdateInput = z.infer<typeof issueUpdateSchema>;
export type IssueFilterInput = z.infer<typeof issueFilterSchema>;
