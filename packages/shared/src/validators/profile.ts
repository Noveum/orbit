import { z } from 'zod';
import { SLUG_PATTERN } from '../constants/index.ts';

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(39)
  .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and dashes.');

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    handle: handleSchema,
    image: z.string().url().max(2048).nullable(),
    timezone: z.string().trim().min(1).max(64),
  })
  .partial();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
