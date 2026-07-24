import { and, db, desc, eq, schema } from '@orbit/db';
import { fetchInstalledRepositoryPage } from '@orbit/services';
import { assertCan } from '@orbit/shared/policy';
import { z } from 'zod';
import { apiContext, handleRoute, searchParamsOf } from '@/lib/api/handler.ts';
import { githubAppConfig, githubDiscoveryReady } from '@/lib/env.ts';

const querySchema = z.object({ cursor: z.string().regex(/^\d+$/).optional() });

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const { cursor } = querySchema.parse(searchParamsOf(request));
    const page = cursor === undefined ? 1 : Number(cursor);

    const [row] = await db
      .select({ externalId: schema.integration.externalId })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, principal.organizationId),
          eq(schema.integration.provider, 'github'),
        ),
      )
      .orderBy(desc(schema.integration.createdAt))
      .limit(1);
    const installationId =
      row !== undefined && /^\d+$/.test(row.externalId) ? row.externalId : null;
    if (installationId === null || !githubDiscoveryReady()) {
      return { repositories: [], nextCursor: null };
    }

    const config = githubAppConfig();
    const result = await fetchInstalledRepositoryPage({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId,
      page,
    });
    return {
      repositories: result.repositories.map((repository) => ({ ...repository, installationId })),
      nextCursor: result.hasMore ? String(page + 1) : null,
    };
  });
}
