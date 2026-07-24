import { and, db, desc, eq, schema } from '@orbit/db';
import { assertCan } from '@orbit/shared/policy';
import { githubLinkRepositorySchema, githubUnlinkRepositorySchema } from '@orbit/shared/validators';
import { randomUUIDv7 } from 'bun';
import { apiContext, handleRoute, readJson, searchParamsOf } from '@/lib/api/handler.ts';
import { assertTeamInWorkspace } from '@/lib/workspace.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const [connected] = await db
      .select({ id: schema.integration.id })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, principal.organizationId),
          eq(schema.integration.provider, 'github'),
        ),
      )
      .limit(1);
    const repositories = await db
      .select({
        id: schema.githubRepositorySync.id,
        repositoryId: schema.githubRepositorySync.repositoryId,
        repositoryName: schema.githubRepositorySync.repositoryName,
        teamId: schema.githubRepositorySync.teamId,
        enabled: schema.githubRepositorySync.enabled,
      })
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.organizationId, principal.organizationId))
      .orderBy(desc(schema.githubRepositorySync.createdAt));
    return { connected: connected !== undefined, repositories };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const input = githubLinkRepositorySchema.parse(await readJson(request));
    await assertTeamInWorkspace(principal, input.teamId);

    const externalId = input.installationId.length > 0 ? input.installationId : 'default';
    const integrationId = await ensureIntegration(
      principal.organizationId,
      externalId,
      principal.userId,
    );

    const row = await db
      .insert(schema.githubRepositorySync)
      .values({
        id: randomUUIDv7(),
        organizationId: principal.organizationId,
        integrationId,
        teamId: input.teamId,
        repositoryId: input.repositoryId,
        repositoryName: input.repositoryName,
        installationId: input.installationId,
        defaultBranch: input.defaultBranch,
      })
      .onConflictDoUpdate({
        target: [
          schema.githubRepositorySync.organizationId,
          schema.githubRepositorySync.repositoryId,
        ],
        set: {
          integrationId,
          teamId: input.teamId,
          repositoryName: input.repositoryName,
          installationId: input.installationId,
          defaultBranch: input.defaultBranch,
          enabled: true,
          updatedAt: new Date(),
        },
      })
      .returning();
    return { repository: row[0] };
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const { repositoryId } = githubUnlinkRepositorySchema.parse(searchParamsOf(request));
    const removed = await db
      .delete(schema.githubRepositorySync)
      .where(
        and(
          eq(schema.githubRepositorySync.organizationId, principal.organizationId),
          eq(schema.githubRepositorySync.repositoryId, repositoryId),
        ),
      )
      .returning({ id: schema.githubRepositorySync.id });
    return { removed: removed.length };
  });
}

async function ensureIntegration(
  organizationId: string,
  externalId: string,
  connectedById: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.integration.id })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, 'github'),
        eq(schema.integration.externalId, externalId),
      ),
    )
    .limit(1);
  if (existing !== undefined) return existing.id;

  const id = randomUUIDv7();
  await db
    .insert(schema.integration)
    .values({ id, organizationId, provider: 'github', externalId, connectedById })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: schema.integration.id })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, 'github'),
        eq(schema.integration.externalId, externalId),
      ),
    )
    .limit(1);
  return row?.id ?? id;
}
