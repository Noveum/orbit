import { z } from 'zod';
import { STATE_CATEGORIES } from '../constants/index.ts';
import { colorSchema, idSchema } from './common.ts';

export const workflowStateCreateSchema = z.object({
  teamId: idSchema,
  name: z.string().trim().min(1).max(48),
  category: z.enum(STATE_CATEGORIES),
  color: colorSchema,
});

export const workflowStateUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(48),
    category: z.enum(STATE_CATEGORIES),
    color: colorSchema,
  })
  .partial();

export const workflowStateListQuerySchema = z.object({
  teamId: idSchema,
});

export const workflowStateReorderSchema = z.object({
  teamId: idSchema,
  stateIds: z.array(idSchema).min(1).max(200),
});

export const workflowStateDeleteQuerySchema = z.object({
  moveToStateId: idSchema.optional(),
});
