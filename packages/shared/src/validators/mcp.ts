import { z } from 'zod';

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
  scope: z.string().optional(),
});
export const mcpConsentValueSchema = z.looseObject({
  clientId: z.string().min(1),
  redirectURI: z.string().min(1),
  scope: z.array(z.string()),
  userId: z.string().min(1),
  requireConsent: z.boolean().optional(),
  state: z.string().nullable().optional(),
});
export const mcpAuthorizationCodeSchema = mcpConsentValueSchema.extend({
  requireConsent: z.literal(false),
  mcpGrantId: z.string().min(1),
  codeChallenge: mcpCodeChallengeSchema,
  codeChallengeMethod: z.enum(['S256', 's256']),
});
