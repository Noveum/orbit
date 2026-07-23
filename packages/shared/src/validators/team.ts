import { z } from 'zod';
import { IDENTIFIER_PATTERN } from '../constants/index.ts';
import { colorSchema, idSchema } from './common.ts';

export const teamCreateSchema = z.object({
  name: z.string().trim().min(2).max(64),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IDENTIFIER_PATTERN, 'Use 2 to 6 uppercase letters or digits.'),
  description: z.string().max(1000).optional(),
  icon: z.string().max(32).optional(),
  color: colorSchema.optional(),
});

export const teamUpdateSchema = teamCreateSchema.partial().omit({ key: true });

export const teamMemberSchema = z.object({
  userId: idSchema,
});

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
