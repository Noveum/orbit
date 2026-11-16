import { z } from 'zod';
import { SLUG_PATTERN } from '../constants/index.ts';
import { ianaTimezoneSchema } from './cycle.ts';

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
    timezone: ianaTimezoneSchema,
  })
  .partial();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
