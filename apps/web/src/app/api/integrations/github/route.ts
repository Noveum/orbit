import { db } from '@orbit/db';
import {
  linkGithubRepository,
  unlinkGithubRepository,
  unlinkGithubRepositoryEverywhere,
} from '@orbit/services';
import { assertCan } from '@orbit/shared/policy';
import { githubLinkRepositorySchema, githubUnlinkRepositorySchema } from '@orbit/shared/validators';
import { loadGithubSettings } from '@/features/settings/github-data.ts';
import { apiContext, handleRoute, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    return await loadGithubSettings(principal);
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const input = githubLinkRepositorySchema.parse(await readJson(request));
    const link = await db.transaction(async (tx) =>
      linkGithubRepository(tx, {
        organizationId: principal.organizationId,
        repositoryId: input.repositoryId,
        projectId: input.projectId,
        linkedById: principal.userId,
      }),
    );
    return { link: { id: link.id, projectId: link.projectId } };
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const input = githubUnlinkRepositorySchema.parse(searchParamsOf(request));

    if (input.scope === 'all') {
      const removed = await db.transaction(async (tx) =>
        unlinkGithubRepositoryEverywhere(tx, {
          organizationId: principal.organizationId,
          repositoryId: input.repositoryId,
        }),
      );
      return { removed };
    }

    const removed = await db.transaction(async (tx) =>
      unlinkGithubRepository(tx, {
        organizationId: principal.organizationId,
        repositoryId: input.repositoryId,
        projectId: input.projectId ?? null,
      }),
    );
    return { removed: removed ? 1 : 0 };
  });
}
