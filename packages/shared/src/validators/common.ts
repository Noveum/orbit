import { z } from 'zod';
import { SLUG_PATTERN } from '../constants/index.ts';

export const idSchema = z.string().min(1).max(64);
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(SLUG_PATTERN, 'Use lowercase and dashes.');
export const emailSchema = z.string().email().max(254).toLowerCase();
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #5A63C8.');
export const markdownSchema = z.string().max(100_000);
export const titleSchema = z.string().trim().min(1, 'Give it a title.').max(255);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(256).optional(),
});
