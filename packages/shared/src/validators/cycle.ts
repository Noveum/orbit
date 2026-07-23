import { z } from 'zod';
import { idSchema } from './common.ts';

export const cycleCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});

export const cycleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .partial();

export type CycleCreateInput = z.infer<typeof cycleCreateSchema>;
