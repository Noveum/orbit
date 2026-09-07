import { and, db, eq, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { aiProviderConfigSchema } from '@orbit/shared/validators';
import { hasAiApiKey } from './credentials.ts';

export interface AiStatus {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly kind: 'openai-compatible' | 'anthropic' | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
  readonly hasApiKey: boolean;
}

export async function loadAiProviderStatus(organizationId: string): Promise<AiStatus> {
  const [row] = await db
    .select({
      id: schema.integration.id,
      config: schema.integration.config,
      credentials: schema.integration.credentials,
    })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, 'ai'),
        eq(schema.integration.externalId, 'default'),
      ),
    )
    .limit(1);

  if (row === undefined) {
    return {
      configured: false,
      enabled: false,
      kind: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    };
  }

  const parsedConfig = aiProviderConfigSchema.safeParse(row.config);
  if (!parsedConfig.success) {
    return {
      configured: false,
      enabled: false,
      kind: null,
      baseUrl: null,
      model: null,
      hasApiKey: false,
    };
  }

  const hasKey = hasAiApiKey(row.credentials);

  return {
    configured: true,
    enabled: parsedConfig.data.enabled && hasKey,
    kind: parsedConfig.data.kind,
    baseUrl: parsedConfig.data.baseUrl,
    model: parsedConfig.data.model,
    hasApiKey: hasKey,
  };
}

export async function aiEnabled(principal: Principal): Promise<boolean> {
  const status = await loadAiProviderStatus(principal.organizationId);
  return status.enabled;
}

export async function aiAdminErrorNotice(
  principal: Principal,
  probeError?: string,
): Promise<string | null> {
  if (principal.role !== 'admin') return null;
  if (probeError === undefined || probeError.length === 0) return null;
  const status = await loadAiProviderStatus(principal.organizationId);
  if (!(status.configured && status.enabled)) return null;
  return probeError;
}
