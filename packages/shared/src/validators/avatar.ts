import { z } from 'zod';
import { AVATAR_MAX_BYTES } from '../constants/index.ts';

export const avatarUploadSchema = z.object({
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .refine((value) => value.startsWith('image/'), 'A profile photo has to be an image.'),
  size: z.number().int().positive().max(AVATAR_MAX_BYTES),
});

export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>;
