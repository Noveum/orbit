import { and, db, eq, schema } from '@orbit/db';
import { complete, decryptAiApiKey } from '@orbit/services/ai';
import { validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { testAiConnectionSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'ai:manage');

    const body = testAiConnectionSchema.parse(await readJson(request));

    let apiKey = body.apiKey;

    if (apiKey === undefined || apiKey.length === 0) {
      const [existing] = await db
        .select({
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

      if (existing === undefined) {
        throw validationFailed('An API key is required to test the connection.');
      }

      const decrypted = decryptAiApiKey(existing.credentials, {
        organizationId: principal.organizationId,
      });

      if (decrypted === null || decrypted.length === 0) {
        throw validationFailed('No valid API key found for this workspace.');
      }

      apiKey = decrypted;
    }

    try {
      const result = await complete('Ping. Respond with "pong".', {
        config: {
          kind: body.kind,
          baseUrl: body.baseUrl,
          model: body.model,
          enabled: true,
        },
        apiKey,
        recordUsage: false,
        timeoutMs: 10_000,
      });

      return {
        ok: true,
        latencyMs: result.latencyMs,
        message: result.text.trim(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection test failed.';
      return { ok: false, error: message };
    }
  });
}
