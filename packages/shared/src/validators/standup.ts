import { z } from 'zod';
import { idSchema } from './common.ts';

export const STANDUP_STATUSES = ['scheduled', 'running', 'finished'] as const;
export const TURN_STATUSES = ['waiting', 'speaking', 'done', 'skipped'] as const;
export const ATTENDANCE = ['unknown', 'present', 'absent'] as const;

export type StandupStatus = (typeof STANDUP_STATUSES)[number];
export type TurnStatus = (typeof TURN_STATUSES)[number];
export type Attendance = (typeof ATTENDANCE)[number];

const daySchema = z.iso.date();

export const standupOpenSchema = z.object({
  teamId: idSchema,
  heldOn: daySchema.optional(),
  facilitatorId: idSchema.nullable().optional(),
  participantIds: z.array(idSchema).max(200).optional(),
});

export const standupUpdateSchema = z.object({
  facilitatorId: idSchema.nullable().optional(),
  status: z.enum(STANDUP_STATUSES).optional(),
});

export const turnUpdateSchema = z.object({
  attendance: z.enum(ATTENDANCE).optional(),
  status: z.enum(TURN_STATUSES).optional(),
  notes: z.string().max(4000).optional(),
  blockers: z.string().max(4000).optional(),
});

export const turnAdvanceSchema = z.object({
  direction: z.enum(['next', 'previous']).default('next'),
  markDone: z.boolean().default(true),
});

export const turnFocusSchema = z.object({ turnId: idSchema });

export const blockerCreateSchema = z.object({
  summary: z.string().min(1).max(500),
  issueId: idSchema.nullable().optional(),
  ownerId: idSchema.nullable().optional(),
});

export const blockerResolveSchema = z.object({ resolved: z.boolean().default(true) });

export const rotationSchema = z.object({
  teamId: idSchema,
  members: z.array(z.object({ userId: idSchema, facilitates: z.boolean().default(true) })).max(200),
});

export const standupBoardQuerySchema = z.object({
  since: z.iso.datetime().optional(),
  limitPerPerson: z.coerce.number().int().min(1).max(100).default(25),
});

export const standupListSchema = z.object({
  teamId: idSchema.optional(),
  cycleId: idSchema.optional(),
  from: daySchema.optional(),
  to: daySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type StandupBoardQuery = z.infer<typeof standupBoardQuerySchema>;
export type StandupOpenInput = z.infer<typeof standupOpenSchema>;
export type TurnUpdateInput = z.infer<typeof turnUpdateSchema>;
export type BlockerCreateInput = z.infer<typeof blockerCreateSchema>;
export type RotationInput = z.infer<typeof rotationSchema>;
