import { z } from 'zod';
import { idSchema } from './common.ts';

export const milestoneCreateSchema = z.object({
  projectId: idSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  targetDate: z.coerce.date().nullable().default(null),
});

export const milestoneUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    targetDate: z.coerce.date().nullable(),
  })
  .partial();
