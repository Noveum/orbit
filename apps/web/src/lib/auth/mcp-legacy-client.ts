import { eq, schema, type Transaction } from '@orbit/db';
import { mcpClientMetadataSchema, mcpLegacyClientSchema } from '@orbit/shared/validators';
import { providerTokenHash } from '@/lib/auth/mcp-provider.ts';

export async function ensureLegacyMcpClient(tx: Transaction, clientId: string): Promise<void> {
  const [legacy] = await tx
    .select()
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, clientId))
    .limit(1)
    .for('update');
  if (legacy === undefined || legacy.providerMigratedAt !== null) return;
  const [existing] = await tx
    .select({ id: schema.oauthProviderClient.id })
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, clientId))
    .limit(1);
  if (existing !== undefined) {
    await tx
      .update(schema.oauthApplication)
      .set({ providerMigratedAt: new Date() })
      .where(eq(schema.oauthApplication.id, legacy.id));
    return;
  }
  const kind = mcpLegacyClientSchema.safeParse(legacy);
  if (!kind.success) return;
  let metadata: unknown;
  try {
    metadata = JSON.parse(legacy.metadata || '{}');
  } catch {
    return;
  }
  const parsedMetadata = mcpClientMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success) return;
  const redirectUris = legacy.redirectUrls.split(',');
  const native = redirectUris.some(
    (uri) =>
      !/^https?:/i.test(uri) ||
      /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:[0-9]+)?(\/|$)/i.test(uri),
  );
  await tx
    .insert(schema.oauthProviderClient)
    .values({
      id: legacy.id,
      clientId: legacy.clientId,
      clientSecret:
        kind.data.type === 'web' && kind.data.clientSecret !== null
          ? providerTokenHash(kind.data.clientSecret)
          : null,
      disabled: legacy.disabled,
      skipConsent: false,
      enableEndSession: false,
      scopes: ['openid', 'profile', 'email', 'offline_access', 'orbit.read', 'orbit.write'],
      clientCredentialsScopes: [],
      userId: legacy.userId,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
      name: legacy.name,
      icon: legacy.icon,
      redirectUris,
      tokenEndpointAuthMethod: kind.data.type === 'public' ? 'none' : 'client_secret_basic',
      applicationType: native ? 'native' : 'web',
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      requirePKCE: true,
      dpopBoundAccessTokens: false,
      metadata: parsedMetadata.data,
      legacyAuthMethods: kind.data.type === 'web',
      legacyResourceMigrationPending: true,
    })
    .onConflictDoNothing({ target: schema.oauthProviderClient.clientId });
  await tx
    .update(schema.oauthApplication)
    .set({ providerMigratedAt: new Date() })
    .where(eq(schema.oauthApplication.id, legacy.id));
}
