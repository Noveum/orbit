import { z } from 'zod';
import { DOC_ACCESS_LEVELS, DOC_ACCESS_SUBJECTS, DOC_VISIBILITIES } from '../constants/index.ts';
import { idSchema } from './common.ts';
import { booleanFlag } from './issue.ts';

export const DOC_CONTENT_LIMIT = 500_000;

export const docContentSchema = z.string().max(DOC_CONTENT_LIMIT, {
  message: 'This document is too long to save. Split it into linked pages.',
});

export const docCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: docContentSchema.default(''),
  projectId: idSchema.nullable().default(null),
  collectionId: idSchema.nullable().default(null),
  parentId: idSchema.nullable().default(null),
  visibility: z.enum(DOC_VISIBILITIES).default('workspace'),
});

export const docUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: docContentSchema,
    projectId: idSchema.nullable(),
    collectionId: idSchema.nullable(),
    parentId: idSchema.nullable(),
    visibility: z.enum(DOC_VISIBILITIES),
  })
  .partial();

export const docShareSchema = z.object({
  visibility: z.enum(DOC_VISIBILITIES),
  rotateToken: z.boolean().default(false),
});

export const docAccessGrantSchema = z.object({
  subjectType: z.enum(DOC_ACCESS_SUBJECTS),
  subjectId: idSchema,
  level: z.enum(DOC_ACCESS_LEVELS),
});

export const docAccessSetSchema = z.object({
  grants: z.array(docAccessGrantSchema).max(200),
});

export const docFilterSchema = z.object({
  query: z.string().trim().max(200).optional(),
  collectionId: idSchema.optional(),
  projectId: idSchema.optional(),
  includeArchived: booleanFlag(false),
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
