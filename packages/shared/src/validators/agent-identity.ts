import { z } from 'zod';
import { idSchema } from './common.ts';

const agentAvatarSchema = z
  .string()
  .max(2048)
  .regex(/^\/api\/avatars\/[^/?#]+\?v=\d+$/, 'Use an Orbit avatar upload.')
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

export const mcpCodeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mcpCodeVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

export const mcpTokenRequestSchema = z
  .object({
    grant_type: z.string().min(1),
    code: z.string().min(1).optional(),
    code_verifier: z.string().optional(),
    refresh_token: z.string().min(1).optional(),
  })
  .catchall(z.string());

export type McpTokenRequest = z.infer<typeof mcpTokenRequestSchema>;

export const mcpTokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

export const mcpAuthorizationCodeSchema = z.object({ mcpGrantId: z.string().min(1) });

export const agentIdentityActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('revoke_connection') }).strict(),
  z.object({ action: z.literal('delete'), reason: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('update_profile'), profile: agentIdentityProfileSchema }).strict(),
]);

export const mcpConsentRequestValueSchema = z
  .object({
    clientId: z.string().min(1),
    redirectURI: z.string().min(1),
    scope: z.array(z.string()),
    userId: z.string().min(1),
    requireConsent: z.boolean().optional(),
    state: z.string().nullable().optional(),
    codeChallenge: z.string().optional(),
    codeChallengeMethod: z.string().optional(),
  })
  .passthrough();

export const mcpConsentDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('deny'), consentCode: z.string().min(1) }).strict(),
  z
    .object({
      decision: z.literal('allow'),
      consentCode: z.string().min(1),
      organizationId: idSchema,
      identitySelection: agentIdentitySelectionSchema,
    })
    .strict(),
]);

export const mcpGrantQuerySchema = z.object({ grantId: idSchema }).strict();

export type AgentIdentityProfile = z.infer<typeof agentIdentityProfileSchema>;
export type AgentIdentitySelection = z.infer<typeof agentIdentitySelectionSchema>;
export type AgentIdentityAction = z.infer<typeof agentIdentityActionSchema>;
export type McpConsentRequestValue = z.infer<typeof mcpConsentRequestValueSchema>;
export type McpConsentDecision = z.infer<typeof mcpConsentDecisionSchema>;
