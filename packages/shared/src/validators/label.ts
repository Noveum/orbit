import { z } from 'zod';
import { colorSchema, idSchema } from './common.ts';

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(48),
  color: colorSchema,
  teamId: idSchema.nullable().default(null),
});

export const labelUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(48),
    color: colorSchema,
    teamId: idSchema.nullable(),
  })
  .partial();
