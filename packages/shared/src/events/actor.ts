import { z } from 'zod';
import { ACTOR_TYPES } from '../constants/index.ts';

export const actorSchema = z.object({
  type: z.enum(ACTOR_TYPES),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
});

export type Actor = z.infer<typeof actorSchema>;
