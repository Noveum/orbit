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

export const milestoneCreateBodySchema = milestoneCreateSchema.omit({ projectId: true });

export const milestoneOrderSchema = z.array(idSchema).max(200);

export const milestoneReorderSchema = z.object({
  milestoneIds: milestoneOrderSchema,
});
