import { z } from 'zod';
import { idSchema } from './common.ts';

const instantSchema = z.union([z.string().trim().min(1), z.date()]).pipe(z.coerce.date());

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isIanaTimezone, 'Use a valid IANA timezone.');

export const cycleCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(120).optional(),
  timezone: ianaTimezoneSchema.optional(),
  startsAt: instantSchema.optional(),
  endsAt: instantSchema.optional(),
});

export const cycleUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timezone: ianaTimezoneSchema,
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
