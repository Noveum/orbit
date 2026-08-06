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

export const sprintOutcomeSchema = z.object({
  scope: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  rolledOver: z.number().int().nonnegative(),
  points: z.object({
    scope: z.number().nonnegative(),
    completed: z.number().nonnegative(),
  }),
  closedAt: z.iso.datetime(),
});

export const cycleListQuerySchema = z.object({
  teamId: idSchema.optional(),
  status: z.enum(['all', 'past']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
