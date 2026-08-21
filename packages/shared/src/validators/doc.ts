import { z } from 'zod';
import {
  DOC_ACCESS_LEVELS,
  DOC_ACCESS_SUBJECTS,
  DOC_KINDS,
  DOC_VISIBILITIES,
} from '../constants/index.ts';
import { idSchema } from './common.ts';
import { booleanFlag } from './issue.ts';

export const DOC_CONTENT_LIMIT = 5_000_000;
export const DOC_TITLE_LIMIT = 200;

export const docContentSchema = z.string().max(DOC_CONTENT_LIMIT, {
  message: 'This document is too long to save. Split it into linked pages.',
});

export const ONE_HOME_MESSAGE = 'A doc lives in a folder or in a project, never both.';

function livesInOnePlace(placement: {
  collectionId?: string | null | undefined;
  projectId?: string | null | undefined;
}): boolean {
  return placement.collectionId == null || placement.projectId == null;
}

export const docCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(DOC_TITLE_LIMIT),
    content: docContentSchema.default(''),
    kind: z.enum(DOC_KINDS).default('markdown'),
    projectId: idSchema.nullable().default(null),
    collectionId: idSchema.nullable().default(null),
    parentId: idSchema.nullable().default(null),
    visibility: z.enum(DOC_VISIBILITIES).default('workspace'),
  })
  .refine(livesInOnePlace, { message: ONE_HOME_MESSAGE, path: ['collectionId'] });

export const docUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(DOC_TITLE_LIMIT),
    content: docContentSchema,
    projectId: idSchema.nullable(),
    collectionId: idSchema.nullable(),
    parentId: idSchema.nullable(),
    visibility: z.enum(DOC_VISIBILITIES),
  })
  .partial()
  .refine(livesInOnePlace, { message: ONE_HOME_MESSAGE, path: ['collectionId'] });

export const docDuplicateSchema = z.object({
  title: z.string().trim().min(1).max(DOC_TITLE_LIMIT).optional(),
});

export const docMoveSchema = z
  .object({
    collectionId: idSchema.nullable().optional(),
    projectId: idSchema.nullable().optional(),
    parentId: idSchema.nullable().optional(),
    beforeId: idSchema.nullable().default(null),
    afterId: idSchema.nullable().default(null),
  })
  .refine(livesInOnePlace, { message: ONE_HOME_MESSAGE, path: ['collectionId'] });

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

export const DOC_ACCESS_MESSAGE_LIMIT = 500;

export const docAccessRequestSchema = z.object({
  message: z.string().trim().max(DOC_ACCESS_MESSAGE_LIMIT).optional(),
});

export const docAccessDecisionSchema = z.object({
  grant: z.boolean(),
  level: z.enum(DOC_ACCESS_LEVELS).default('read'),
});

export const DOC_LIST_LIMIT = 500;

export const docFilterSchema = z.object({
  query: z.string().trim().max(200).optional(),
  collectionId: idSchema.optional(),
  projectId: idSchema.optional(),
  unfiled: booleanFlag(false),
  includeArchived: booleanFlag(false),
  limit: z.coerce.number().int().min(1).max(DOC_LIST_LIMIT).default(DOC_LIST_LIMIT),
});

export const docFavoriteSchema = z.object({ favorite: z.boolean() });

export const docHomeSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export const docCollectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(32).default('book'),
});

export const docCollectionUpdateSchema = docCollectionCreateSchema.partial();

export type DocCreateInput = z.infer<typeof docCreateSchema>;
export type DocUpdateInput = z.infer<typeof docUpdateSchema>;
export type DocMoveInput = z.infer<typeof docMoveSchema>;
export type DocFilterInput = z.infer<typeof docFilterSchema>;
export type DocHomeInput = z.infer<typeof docHomeSchema>;
export type DocCollectionCreateInput = z.infer<typeof docCollectionCreateSchema>;
