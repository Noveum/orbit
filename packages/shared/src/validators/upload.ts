import { z } from 'zod';
import { ALLOWED_UPLOAD_MIME_PREFIXES, MAX_UPLOAD_BYTES } from '../constants/index.ts';
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
