import { z } from 'zod';

export const controlMessageSchema = z.object({
  type: z.literal('session_revoked'),
  userId: z.string().min(1),
});

export type ControlMessage = z.infer<typeof controlMessageSchema>;
