import { z } from 'zod';
import {
  ALLOWED_UPLOAD_MIME_PREFIXES,
  base64LengthFor,
  MAX_INLINE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
} from '../constants/index.ts';
import { idSchema } from './common.ts';

export const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (value) => ALLOWED_UPLOAD_MIME_PREFIXES.some((prefix) => value.startsWith(prefix)),
      'That file type is not supported.',
    ),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  parentType: z.enum(['issue', 'comment', 'doc', 'project']),
  parentId: idSchema,
});

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

export const inlineUploadSchema = uploadRequestSchema.omit({ size: true }).extend({
  content: z.base64().max(base64LengthFor(MAX_INLINE_UPLOAD_BYTES)),
});

export type InlineUploadInput = z.infer<typeof inlineUploadSchema>;

const storageKeySegmentSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/, 'A storage key segment may only contain safe characters.')
  .refine(
    (segment) => segment !== '.' && segment !== '..',
    'A storage key segment may not walk the path.',
  );

export const storageKeySchema = z.array(storageKeySegmentSchema).min(1).max(8);
