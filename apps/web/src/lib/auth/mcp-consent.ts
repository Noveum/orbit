import { randomBytes } from 'node:crypto';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import {
  type FinalizeMcpConsentInput,
  finalizeMcpConsent,
  getMcpClient,
  getMcpConsentRequest,
} from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { unauthorized } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import {
  mcpAuthorizationCodeSchema,
  mcpProviderConsentQuerySchema,
  mcpResourceSelectionSchema,
} from '@orbit/shared/validators';
import { ensureLegacyMcpClient } from '@/lib/auth/mcp-legacy-client.ts';
import { withMcpConsentGrant } from '@/lib/auth/mcp-provider.ts';
import type { auth } from '@/lib/auth/server.ts';
import { serverEnv } from '@/lib/env.ts';

export async function linkMigratedMcpResource(query: unknown, resource: string): Promise<void> {
  const parsed = mcpResourceSelectionSchema.safeParse(query);
  if (!parsed.success) return;
  const selection = parsed.data.resource;
  const requested = Array.isArray(selection)
    ? selection
    : [selection].filter((value) => value !== undefined);
  if (requested.some((identifier) => identifier !== resource)) return;
  await db.transaction(async (tx) => {
    await ensureLegacyMcpClient(tx, parsed.data.client_id);
    const [client] = await tx
      .select()
      .from(schema.oauthProviderClient)
      .where(
        and(
          eq(schema.oauthProviderClient.clientId, parsed.data.client_id),
          eq(schema.oauthProviderClient.legacyResourceMigrationPending, true),
          eq(schema.oauthProviderClient.disabled, false),
        ),
      )
      .limit(1)
      .for('update');
    if (client === undefined) return;
    const [target] = await tx
      .select()
      .from(schema.oauthProviderResource)
      .where(
        and(
          eq(schema.oauthProviderResource.identifier, resource),
          eq(schema.oauthProviderResource.disabled, false),
        ),
      )
      .limit(1);
    if (target === undefined) return;
    await tx
      .insert(schema.oauthProviderClientResource)
      .values({
        id: randomUUIDv7(),
        clientId: client.clientId,
        resourceId: target.identifier,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          schema.oauthProviderClientResource.clientId,
          schema.oauthProviderClientResource.resourceId,
        ],
      });
    await tx
      .update(schema.oauthProviderClient)
      .set({ legacyResourceMigrationPending: false })
      .where(eq(schema.oauthProviderClient.id, client.id));
  });
}

export function providerConsentQuery(
  parameters: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === 'string') query.append(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  return query.toString();
}

export async function createProviderConsent(userId: string, oauthQuery: string): Promise<string> {
  const invalid = unauthorized('This authorization request is invalid or has expired.');
  if (!(await verifyOAuthQueryParams(oauthQuery, serverEnv().BETTER_AUTH_SECRET))) throw invalid;
  const query = new URLSearchParams(oauthQuery);
  for (const key of [...Object.keys(mcpProviderConsentQuerySchema.shape), 'state']) {
    if (query.getAll(key).length > 1) throw invalid;
  }
  const parsed = mcpProviderConsentQuerySchema.safeParse(Object.fromEntries(query));
  if (!parsed.success) throw invalid;
  const value = parsed.data;
  const [client] = await db
    .select()
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, value.client_id))
    .limit(1);
  if (client === undefined || client.disabled) throw invalid;
  if ((await getMcpClient(client.clientId)) === null) {
    await db
      .insert(schema.oauthApplication)
      .values({
        id: randomUUIDv7(),
        clientId: client.clientId,
        name: client.name ?? 'An MCP client',
        icon: client.icon,
        metadata: client.metadata === null ? null : JSON.stringify(client.metadata),
        redirectUrls: client.redirectUris.join(','),
        type: client.tokenEndpointAuthMethod === 'none' ? 'public' : 'web',
        disabled: client.disabled ?? false,
        userId: client.userId,
      })
      .onConflictDoNothing({ target: schema.oauthApplication.clientId });
  }
  const consentCode = randomBytes(32).toString('base64url');
  await db.insert(schema.verification).values({
    id: randomUUIDv7(),
    identifier: consentCode,
    value: JSON.stringify({
      userId,
      clientId: client.clientId,
      redirectURI: value.redirect_uri,
      scope: value.scope.split(/\s+/).filter(Boolean),
      state: query.get('state'),
      codeChallenge: value.code_challenge,
      codeChallengeMethod: value.code_challenge_method,
      requireConsent: true,
      oauthQuery,
    }),
    expiresAt: new Date(Math.min(value.exp * 1000, Date.now() + 600_000)),
  });
  return consentCode;
}

export async function finalizeProviderConsent(
  input: FinalizeMcpConsentInput,
  provider: Pick<typeof auth.api, 'oauth2Consent'>,
  headers: Headers,
) {
  const consent = await getMcpConsentRequest(input.userId, input.consentCode);
  const finalized = await finalizeMcpConsent(input);
  if (consent.oauthQuery === undefined) return finalized;
  if (!input.accept) {
    const result = await provider.oauth2Consent({
      headers,
      body: { accept: false, oauth_query: consent.oauthQuery },
    });
    return { ...finalized, redirectUri: result.url };
  }
  const code = new URL(finalized.redirectUri).searchParams.get('code') ?? '';
  const [record] = await db
    .select()
    .from(schema.verification)
    .where(eq(schema.verification.identifier, code))
    .limit(1);
  const value = mcpAuthorizationCodeSchema.parse(JSON.parse(record?.value ?? 'null'));
  try {
    const result = await withMcpConsentGrant(value.mcpGrantId, () =>
      provider.oauth2Consent({
        headers,
        body: { accept: true, scope: finalized.scope, oauth_query: consent.oauthQuery },
      }),
    );
    return { ...finalized, redirectUri: result.url };
  } finally {
    await db.delete(schema.verification).where(eq(schema.verification.identifier, code));
  }
}
