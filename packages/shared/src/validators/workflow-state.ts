import { z } from 'zod';
import { STATE_CATEGORIES } from '../constants/index.ts';
import { colorSchema, idSchema } from './common.ts';

export const workflowStateCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(48),
  category: z.enum(STATE_CATEGORIES),
  color: colorSchema,
  position: z.number().int().min(0).max(10_000).optional(),
});

export const workflowStateUpdateSchema = workflowStateCreateSchema.partial().omit({ teamId: true });
