import { z } from 'zod';
import { idSchema, markdownSchema } from './common.ts';

export const commentCreateSchema = z.object({
  body: markdownSchema.refine((value) => value.trim().length > 0, 'Write something first.'),
  parentId: idSchema.nullable().default(null),
});

export const commentUpdateSchema = z.object({
  body: markdownSchema.refine((value) => value.trim().length > 0, 'Write something first.'),
});

export const DOC_ANCHOR_QUOTE_LIMIT = 2_000;
export const DOC_ANCHOR_CONTEXT_LIMIT = 96;

const HALF_A_CHARACTER = /\p{Surrogate}/u;
const CUT_THROUGH = 'A passage cannot start or end in the middle of a character.';

function isWholeText(value: string): boolean {
  return !HALF_A_CHARACTER.test(value);
}

const anchorContext = z
  .string()
  .max(DOC_ANCHOR_CONTEXT_LIMIT)
  .refine(isWholeText, CUT_THROUGH)
  .default('');

export const docCommentAnchorSchema = z.object({
  quote: z
    .string()
    .min(1, 'Select the text you want to comment on.')
    .max(DOC_ANCHOR_QUOTE_LIMIT)
    .refine(isWholeText, CUT_THROUGH),
  prefix: anchorContext,
  suffix: anchorContext,
  start: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const docCommentCreateSchema = commentCreateSchema.extend({
  anchor: docCommentAnchorSchema.nullable().default(null),
});

export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

export const commentQuerySchema = z.object({ issueId: idSchema });

export type CommentCreateInput = z.infer<typeof commentCreateSchema>;
export type DocCommentAnchor = z.infer<typeof docCommentAnchorSchema>;
export type DocCommentCreateInput = z.infer<typeof docCommentCreateSchema>;
