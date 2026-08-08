import { z } from 'zod';

export const controlMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session_revoked'),
    userId: z.string().min(1),
  }),
  z.object({
    type: z.literal('organization_deleted'),
    organizationId: z.string().min(1),
  }),
]);

export type ControlMessage = z.infer<typeof controlMessageSchema>;
