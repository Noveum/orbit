import {
  githubInstallation,
  githubRepository,
  githubRepositoryLink,
  githubRepositorySync,
} from '@orbit/db/schema';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GithubDatabase } from './apply.ts';

interface WatchedRow {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly defaultBranch: string;
  readonly integrationId: string;
  readonly installationId: string;
}

const WATCHED_FACTS = {
  integrationId: sql`excluded.integration_id`,
  repositoryName: sql`excluded.repository_name`,
  installationId: sql`excluded.installation_id`,
  defaultBranch: sql`excluded.default_branch`,
};

async function desiredWatchedRows(
  database: GithubDatabase,
  organizationId: string,
): Promise<WatchedRow[]> {
  return await database
    .selectDistinct({
      repositoryId: githubRepository.repositoryId,
      repositoryName: githubRepository.fullName,
      defaultBranch: githubRepository.defaultBranch,
      integrationId: githubInstallation.integrationId,
      installationId: githubInstallation.installationId,
    })
    .from(githubRepositoryLink)
    .innerJoin(githubRepository, eq(githubRepository.id, githubRepositoryLink.repositoryRowId))
    .innerJoin(githubInstallation, eq(githubInstallation.id, githubRepository.installationRowId))
    .where(eq(githubRepositoryLink.organizationId, organizationId));
}

async function catalogueRepositoryIds(
  database: GithubDatabase,
  organizationId: string,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ repositoryId: githubRepository.repositoryId })
    .from(githubRepository)
    .where(eq(githubRepository.organizationId, organizationId));
  return rows.map((row) => row.repositoryId);
}

export async function reconcileWatchedRepositories(
  database: GithubDatabase,
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  const desired = await desiredWatchedRows(database, organizationId);
  const owned = await catalogueRepositoryIds(database, organizationId);
  const keep = new Set(desired.map((row) => row.repositoryId));
  const drop = owned.filter((repositoryId) => !keep.has(repositoryId));

  if (drop.length > 0) {
    await database
      .delete(githubRepositorySync)
      .where(
        and(
          eq(githubRepositorySync.organizationId, organizationId),
          inArray(githubRepositorySync.repositoryId, drop),
        ),
      );
  }
  if (desired.length === 0) return 0;

  await database
    .insert(githubRepositorySync)
    .values(
      desired.map((row) => ({
        id: randomUUIDv7(),
        organizationId,
        integrationId: row.integrationId,
        teamId: null,
        repositoryId: row.repositoryId,
        repositoryName: row.repositoryName,
        installationId: row.installationId,
        defaultBranch: row.defaultBranch,
      })),
    )
    .onConflictDoUpdate({
      target: [githubRepositorySync.organizationId, githubRepositorySync.repositoryId],
      set: { ...WATCHED_FACTS, enabled: true, updatedAt: now },
    });
  return desired.length;
}

export async function forgetWatchedRepositories(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly repositoryIds: readonly string[] },
): Promise<number> {
  if (input.repositoryIds.length === 0) return 0;
  const removed = await database
    .delete(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.organizationId, input.organizationId),
        inArray(githubRepositorySync.repositoryId, [...input.repositoryIds]),
      ),
    )
    .returning({ id: githubRepositorySync.id });
  return removed.length;
}
