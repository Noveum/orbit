import { eq, schema, sql, type Transaction } from '@orbit/db';
import { mcpClientMetadataSchema, mcpLegacyClientSchema } from '@orbit/shared/validators';
import { providerTokenHash } from '@/lib/auth/mcp-provider.ts';
import { isSafeMcpRedirectUri } from '@/lib/auth/mcp-redirect-uri.ts';

function nativeLegacyRedirects(uris: readonly string[]): boolean {
  return uris.some((uri) => isSafeMcpRedirectUri(uri) && new URL(uri).protocol !== 'https:');
}

async function repairUntouchedLegacyNativeClient(
  tx: Transaction,
  legacy: typeof schema.oauthApplication.$inferSelect,
): Promise<void> {
  const uris = legacy.redirectUrls.split(',');
  if (
    !nativeLegacyRedirects(uris) ||
    uris.some(
      (uri) =>
        !/^https?:/i.test(uri) ||
        /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:[0-9]+)?(\/|$)/i.test(uri),
    ) ||
    !mcpLegacyClientSchema.safeParse(legacy).success
  )
    return;
  let metadata: unknown;
  try {
    metadata = JSON.parse(legacy.metadata || '{}');
  } catch {
    return;
  }
  if (!mcpClientMetadataSchema.safeParse(metadata).success) return;
  const [existing] = await tx
    .select({ id: schema.oauthProviderClient.id })
    .from(schema.oauthProviderClient)
    .where(eq(schema.oauthProviderClient.clientId, legacy.clientId))
    .limit(1)
    .for('update');
  if (existing === undefined) return;
  await tx.execute(sql`
    update oauth_provider_client copied
    set application_type = 'native', updated_at = current_timestamp
    from oauth_application legacy
    where legacy.id = ${legacy.id}
      and legacy.provider_migrated_at is not null
      and legacy.disabled is false
      and copied.id = legacy.id
      and copied.client_id = legacy.client_id
      and copied.application_type = 'web'
      and copied.disabled is false
      and copied.client_secret is not distinct from case
        when legacy.type = 'public' then null
        else rtrim(translate(encode(sha256(convert_to(legacy.client_secret, 'UTF8')), 'base64'), '+/', '-_'), '=')
      end
      and copied.skip_consent is false
      and copied.enable_end_session is false
      and copied.scopes = array['openid', 'profile', 'email', 'offline_access', 'orbit.read', 'orbit.write']
      and copied.client_credentials_scopes = array[]::text[]
      and copied.user_id is not distinct from legacy.user_id
      and copied.created_at is not distinct from legacy.created_at
      and copied.updated_at is not distinct from legacy.updated_at
      and copied.name is not distinct from legacy.name
      and copied.icon is not distinct from legacy.icon
      and copied.redirect_uris = string_to_array(legacy.redirect_urls, ',')
      and copied.token_endpoint_auth_method = case
        when legacy.type = 'public' then 'none' else 'client_secret_basic'
      end
      and copied.grant_types = array['authorization_code', 'refresh_token']
      and copied.response_types = array['code']
      and copied.require_p_k_c_e is true
      and copied.dpop_bound_access_tokens is false
      and copied.metadata is not distinct from coalesce(nullif(legacy.metadata, '')::jsonb, '{}'::jsonb)
      and copied.legacy_auth_methods = (legacy.type = 'web')
      and copied.legacy_resource_migration_pending is true
      and copied.client_discovery_id is null
      and copied.subject_type is null
      and copied.uri is null
      and copied.contacts is null
      and copied.tos is null
      and copied.policy is null
      and copied.software_id is null
      and copied.software_version is null
      and copied.software_statement is null
      and copied.post_logout_redirect_uris is null
      and copied.backchannel_logout_uri is null
      and copied.backchannel_logout_session_required is null
      and copied.jwks is null
      and copied.jwks_uri is null
      and copied.reference_id is null
      and not exists (
        select 1 from oauth_provider_client_resource linked
        where linked.client_id = copied.client_id
      )
  `);
}

export async function ensureLegacyMcpClient(tx: Transaction, clientId: string): Promise<void> {
  const [legacy] = await tx
    .select()
    .from(schema.oauthApplication)
    .where(eq(schema.oauthApplication.clientId, clientId))
    .limit(1)
    .for('update');
  if (legacy === undefined) return;
  if (legacy.providerMigratedAt !== null) {
    await repairUntouchedLegacyNativeClient(tx, legacy);
    return;
  }
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
  const native = nativeLegacyRedirects(redirectUris);
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
