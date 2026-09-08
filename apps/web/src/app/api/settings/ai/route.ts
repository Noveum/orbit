import { and, db, eq, schema } from '@orbit/db';
import {
  encryptAiApiKey,
  hasAiApiKey,
  loadAiProviderStatus,
  loadAiUsage,
} from '@orbit/services/ai';
import { validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { aiProviderConfigSchema, saveAiConfigSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'ai:manage');

    const [status, usage] = await Promise.all([
      loadAiProviderStatus(principal.organizationId),
      loadAiUsage(principal.organizationId),
    ]);

    return {
      configured: status.configured,
      enabled: status.enabled,
      kind: status.kind,
      baseUrl: status.baseUrl,
      model: status.model,
      hasApiKey: status.hasApiKey,
      usage,
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'ai:manage');

    const body = saveAiConfigSchema.parse(await readJson(request));

    const [existing] = await db
      .select({
        id: schema.integration.id,
        config: schema.integration.config,
        credentials: schema.integration.credentials,
      })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, principal.organizationId),
          eq(schema.integration.provider, 'ai'),
          eq(schema.integration.externalId, 'default'),
        ),
      )
      .limit(1);

    const config = {
      kind: body.kind,
      baseUrl: body.baseUrl,
      model: body.model,
      enabled: body.enabled,
    };

    if (body.apiKey !== undefined && body.apiKey.length > 0) {
      const envelope = encryptAiApiKey({
        organizationId: principal.organizationId,
        apiKey: body.apiKey,
      });

      await db
        .insert(schema.integration)
        .values({
          id: randomUUIDv7(),
          organizationId: principal.organizationId,
          provider: 'ai',
          externalId: 'default',
          config,
          credentials: { apiKey: envelope },
          connectedById: principal.userId,
        })
        .onConflictDoUpdate({
          target: [
            schema.integration.organizationId,
            schema.integration.provider,
            schema.integration.externalId,
          ],
          set: {
            config,
            credentials: { apiKey: envelope },
            updatedAt: new Date(),
          },
        });
    } else {
      if (existing === undefined || !hasAiApiKey(existing.credentials)) {
        throw validationFailed('An API key is required when setting up an AI provider.');
      }
      const parsedConfig = aiProviderConfigSchema.safeParse(existing.config);
      if (
        !parsedConfig.success ||
        parsedConfig.data.baseUrl !== body.baseUrl ||
        parsedConfig.data.kind !== body.kind
      ) {
        throw validationFailed(
          'An API key is required when changing the AI provider kind or endpoint.',
        );
      }
      const updated = await db
        .update(schema.integration)
        .set({
          config,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integration.id, existing.id),
            eq(schema.integration.organizationId, principal.organizationId),
            eq(schema.integration.provider, 'ai'),
            eq(schema.integration.externalId, 'default'),
          ),
        )
        .returning({ id: schema.integration.id });

      if (updated.length === 0) {
        throw validationFailed(
          'The AI integration was disconnected before changes could be saved.',
        );
      }
    }

    const [status, usage] = await Promise.all([
      loadAiProviderStatus(principal.organizationId),
      loadAiUsage(principal.organizationId),
    ]);

    return {
      configured: status.configured,
      enabled: status.enabled,
      kind: status.kind,
      baseUrl: status.baseUrl,
      model: status.model,
      hasApiKey: status.hasApiKey,
      usage,
    };
  });
}

export async function DELETE(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'ai:manage');

    await db
      .delete(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, principal.organizationId),
          eq(schema.integration.provider, 'ai'),
          eq(schema.integration.externalId, 'default'),
        ),
      );

    return { ok: true };
  });
}
