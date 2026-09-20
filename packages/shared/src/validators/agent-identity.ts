import { z } from 'zod';
import { idSchema } from './common.ts';

const agentAvatarSchema = z
  .string()
  .max(2048)
  .refine((value) => value.startsWith('/api/avatars/'), 'Use an Orbit avatar upload.')
  .nullable();

export const agentIdentityProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    avatar: agentAvatarSchema,
  })
  .strict();

export const agentIdentitySelectionSchema = z.union([
  z
    .object({
      agentIdentityId: idSchema,
      replaceActiveGrant: z.boolean(),
    })
    .strict(),
  z
    .object({
      createAgent: agentIdentityProfileSchema,
    })
    .strict(),
]);

export const actorRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), id: idSchema }).strict(),
  z.object({ type: z.literal('agent'), id: idSchema }).strict(),
]);

export const idempotencyKeySchema = z.string().trim().min(1).max(128);

export const agentIdentityActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('revoke_connection') }).strict(),
  z.object({ action: z.literal('delete'), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('update_profile'), profile: agentIdentityProfileSchema }).strict(),
]);

export type AgentIdentityProfile = z.infer<typeof agentIdentityProfileSchema>;
export type AgentIdentitySelection = z.infer<typeof agentIdentitySelectionSchema>;
export type AgentIdentityAction = z.infer<typeof agentIdentityActionSchema>;
