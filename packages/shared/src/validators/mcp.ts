import { z } from 'zod';

export const mcpClientRegistrationCompatibilitySchema = z.looseObject({
  redirect_uris: z.array(z.url()).min(1),
  application_type: z.enum(['web', 'native']).optional(),
});
export const mcpRevocationRequestSchema = z
  .object({ token: z.string().min(1) })
  .catchall(z.string());
export const mcpResourceSelectionSchema = z.object({
  client_id: z.string().min(1),
  resource: z.union([z.url(), z.array(z.url())]).optional(),
});

export const mcpCodeChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const mcpProviderConsentQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.url(),
  scope: z.string().min(1),
  prompt: z.literal('consent'),
  code_challenge: mcpCodeChallengeSchema,
  code_challenge_method: z.literal('S256'),
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(1),
});
export const mcpProviderAuthorizationCodeSchema = z.object({
  type: z.literal('authorization_code'),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  referenceId: z.string().min(1),
  query: z.object({
    client_id: z.string().min(1),
    redirect_uri: z.url(),
    scope: z.string().min(1),
    code_challenge: mcpCodeChallengeSchema,
    code_challenge_method: z.literal('S256'),
  }),
});
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
  oauthQuery: z.string().optional(),
});
export const mcpAuthorizationCodeSchema = mcpConsentValueSchema.extend({
  requireConsent: z.literal(false),
  mcpGrantId: z.string().min(1),
  codeChallenge: mcpCodeChallengeSchema,
  codeChallengeMethod: z.enum(['S256', 's256']),
});

export const mcpLegacyClientSchema = z
  .object({
    type: z.enum(['public', 'web']),
    clientSecret: z.string().nullable(),
  })
  .refine((client) =>
    client.type === 'public' ? !client.clientSecret : Boolean(client.clientSecret),
  );
export const mcpClientMetadataSchema = z.record(z.string(), z.unknown()).nullable();
