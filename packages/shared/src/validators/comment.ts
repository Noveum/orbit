import { z } from 'zod';
import { idSchema, markdownSchema } from './common.ts';

export const commentCreateSchema = z.object({
  body: markdownSchema.refine((value) => value.trim().length > 0, 'Write something first.'),
  parentId: idSchema.nullable().default(null),
});

export const commentUpdateSchema = z.object({
  body: markdownSchema.refine((value) => value.trim().length > 0, 'Write something first.'),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const commentQuerySchema = z.object({ issueId: idSchema });

export type CommentCreateInput = z.infer<typeof commentCreateSchema>;
