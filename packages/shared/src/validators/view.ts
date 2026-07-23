import { z } from 'zod';
import { GROUP_BY_FIELDS, VIEW_LAYOUTS } from '../filters/index.ts';
import { issueFilterSchema } from './issue.ts';

export const viewCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filter: issueFilterSchema.partial(),
  layout: z.enum(VIEW_LAYOUTS).default('list'),
  groupBy: z.enum(GROUP_BY_FIELDS).default('state'),
  shared: z.boolean().default(false),
});

export const viewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    filter: issueFilterSchema.partial(),
    layout: z.enum(VIEW_LAYOUTS),
    groupBy: z.enum(GROUP_BY_FIELDS),
    shared: z.boolean(),
  })
  .partial();

export type ViewCreateInput = z.infer<typeof viewCreateSchema>;
