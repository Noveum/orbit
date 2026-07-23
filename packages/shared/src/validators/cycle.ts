import { z } from 'zod';
import { idSchema } from './common.ts';

const instantSchema = z.union([z.string().trim().min(1), z.date()]).pipe(z.coerce.date());

export const cycleCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  startsAt: instantSchema,
  endsAt: instantSchema,
});

export const cycleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsAt: instantSchema,
    endsAt: instantSchema,
  })
  .partial();

export type CycleCreateInput = z.infer<typeof cycleCreateSchema>;
