import { z } from 'zod';
import { DOC_VISIBILITIES } from '../constants/index.ts';
import { idSchema, markdownSchema } from './common.ts';

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

export const docShareSchema = z.object({
  visibility: z.enum(DOC_VISIBILITIES),
});

export const docFilterSchema = z.object({
  query: z.string().trim().max(200).optional(),
  collectionId: idSchema.optional(),
  projectId: idSchema.optional(),
  includeArchived: z.coerce.boolean().default(false),
});

export const docCollectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(32).default('book'),
});

export const docCollectionUpdateSchema = docCollectionCreateSchema.partial();

export type DocCreateInput = z.infer<typeof docCreateSchema>;
export type DocUpdateInput = z.infer<typeof docUpdateSchema>;
export type DocFilterInput = z.infer<typeof docFilterSchema>;
export type DocCollectionCreateInput = z.infer<typeof docCollectionCreateSchema>;
