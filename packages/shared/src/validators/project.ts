import { z } from 'zod';
import { PROJECT_HEALTHS, PROJECT_STATUSES } from '../constants/index.ts';
import { colorSchema, idSchema, markdownSchema } from './common.ts';

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  summary: z.string().max(500).default(''),
  description: markdownSchema.default(''),
  status: z.enum(PROJECT_STATUSES).default('backlog'),
  health: z.enum(PROJECT_HEALTHS).default('no_update'),
  leadId: idSchema.nullable().default(null),
  startDate: z.coerce.date().nullable().default(null),
  targetDate: z.coerce.date().nullable().default(null),
  teamIds: z.array(idSchema).max(50).default([]),
  icon: z.string().max(32).optional(),
  color: colorSchema.optional(),
});

export const projectUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    summary: z.string().max(500),
    description: markdownSchema,
    status: z.enum(PROJECT_STATUSES),
    health: z.enum(PROJECT_HEALTHS),
    leadId: idSchema.nullable(),
    startDate: z.coerce.date().nullable(),
    targetDate: z.coerce.date().nullable(),
    teamIds: z.array(idSchema).max(50),
    icon: z.string().max(32),
    color: colorSchema,
  })
  .partial();

export const projectUpdatePostSchema = z.object({
  health: z.enum(PROJECT_HEALTHS),
  body: markdownSchema,
});

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
