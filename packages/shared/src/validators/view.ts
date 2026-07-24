import { z } from 'zod';
import { GROUP_BY_FIELDS, VIEW_LAYOUTS, viewStateSchema } from '../filters/index.ts';

export const viewCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filter: viewStateSchema,
  layout: z.enum(VIEW_LAYOUTS).default('list'),
  groupBy: z.enum(GROUP_BY_FIELDS).default('state'),
  shared: z.boolean().default(false),
});

export const viewUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    filter: viewStateSchema,
  })
  .partial();

export const viewFavoriteSchema = z.object({ favorite: z.boolean() });

export type ViewCreateInput = z.infer<typeof viewCreateSchema>;
