import {
  githubInstallation,
  githubRepository,
  githubRepositoryLink,
  project,
} from '@orbit/db/schema';
import { notFound, validationFailed } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { GithubDatabase } from './apply.ts';
import type { GithubRepositoryRow } from './installations.ts';
import { reconcileWatchedRepositories } from './watched.ts';

export type GithubRepositoryLinkRow = typeof githubRepositoryLink.$inferSelect;

export interface GithubRepositoryProjectLink {
  readonly id: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
}

export interface GithubCatalogueEntry {
  readonly id: string;
  readonly repositoryId: string;
  readonly fullName: string;
  readonly name: string;
  readonly ownerLogin: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly installationId: string;
  readonly accountLogin: string;
  readonly links: GithubRepositoryProjectLink[];
}

export async function listGithubCatalogue(
  database: GithubDatabase,
  organizationId: string,
): Promise<GithubCatalogueEntry[]> {
  const rows = await database
    .select({
      id: githubRepository.id,
      repositoryId: githubRepository.repositoryId,
      fullName: githubRepository.fullName,
      name: githubRepository.name,
      ownerLogin: githubRepository.ownerLogin,
      private: githubRepository.private,
      archived: githubRepository.archived,
      defaultBranch: githubRepository.defaultBranch,
      htmlUrl: githubRepository.htmlUrl,
      installationId: githubInstallation.installationId,
      accountLogin: githubInstallation.accountLogin,
    })
    .from(githubRepository)
    .innerJoin(githubInstallation, eq(githubInstallation.id, githubRepository.installationRowId))
    .where(eq(githubRepository.organizationId, organizationId))
    .orderBy(asc(githubInstallation.accountLogin), asc(githubRepository.fullName));

  const links = await database
    .select({
      id: githubRepositoryLink.id,
      repositoryRowId: githubRepositoryLink.repositoryRowId,
      projectId: githubRepositoryLink.projectId,
      projectName: project.name,
    })
    .from(githubRepositoryLink)
    .leftJoin(project, eq(project.id, githubRepositoryLink.projectId))
    .where(eq(githubRepositoryLink.organizationId, organizationId))
    .orderBy(asc(githubRepositoryLink.createdAt));

  const byRepository = new Map<string, GithubRepositoryProjectLink[]>();
  for (const link of links) {
    const bucket = byRepository.get(link.repositoryRowId) ?? [];
    bucket.push({ id: link.id, projectId: link.projectId, projectName: link.projectName });
    byRepository.set(link.repositoryRowId, bucket);
  }

  return rows.map((row) => ({ ...row, links: byRepository.get(row.id) ?? [] }));
}

async function repositoryInWorkspace(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly repositoryId: string },
): Promise<GithubRepositoryRow> {
  const [row] = await database
    .select()
    .from(githubRepository)
    .where(
      and(
        eq(githubRepository.organizationId, input.organizationId),
        eq(githubRepository.repositoryId, input.repositoryId),
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw notFound('That repository is not connected to this workspace.');
  }
  return row;
}

async function assertProjectInWorkspace(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly projectId: string },
): Promise<void> {
  const [row] = await database
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.organizationId, input.organizationId), eq(project.id, input.projectId)))
    .limit(1);
  if (row === undefined) throw notFound('That project does not exist in this workspace.');
}

export interface LinkRepositoryInput {
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly projectId: string | null;
  readonly linkedById: string;
  readonly now?: Date;
}

export async function linkGithubRepository(
  database: GithubDatabase,
  input: LinkRepositoryInput,
): Promise<GithubRepositoryLinkRow> {
  const repository = await repositoryInWorkspace(database, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
  });
  if (input.projectId !== null) {
    await assertProjectInWorkspace(database, {
      organizationId: input.organizationId,
      projectId: input.projectId,
    });
  }

  const now = input.now ?? new Date();
  const existing = await findLink(database, repository.id, input.projectId);
  if (existing !== null) {
    await reconcileWatchedRepositories(database, input.organizationId, now);
    return existing;
  }

  const [row] = await database
    .insert(githubRepositoryLink)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      repositoryRowId: repository.id,
      projectId: input.projectId,
      linkedById: input.linkedById,
    })
    .returning();
  if (row === undefined) throw validationFailed('Could not link that repository.');
  await reconcileWatchedRepositories(database, input.organizationId, now);
  return row;
}

async function findLink(
  database: GithubDatabase,
  repositoryRowId: string,
  projectId: string | null,
): Promise<GithubRepositoryLinkRow | null> {
  const match =
    projectId === null
      ? and(
          eq(githubRepositoryLink.repositoryRowId, repositoryRowId),
          isNull(githubRepositoryLink.projectId),
        )
      : and(
          eq(githubRepositoryLink.repositoryRowId, repositoryRowId),
          eq(githubRepositoryLink.projectId, projectId),
        );
  const [row] = await database.select().from(githubRepositoryLink).where(match).limit(1);
  return row ?? null;
}

export interface UnlinkRepositoryInput {
  readonly organizationId: string;
  readonly repositoryId: string;
  readonly projectId: string | null;
}

export async function unlinkGithubRepository(
  database: GithubDatabase,
  input: UnlinkRepositoryInput,
): Promise<boolean> {
  const repository = await repositoryInWorkspace(database, {
    organizationId: input.organizationId,
    repositoryId: input.repositoryId,
  });
  const scoped =
    input.projectId === null
      ? and(
          eq(githubRepositoryLink.organizationId, input.organizationId),
          eq(githubRepositoryLink.repositoryRowId, repository.id),
          isNull(githubRepositoryLink.projectId),
        )
      : and(
          eq(githubRepositoryLink.organizationId, input.organizationId),
          eq(githubRepositoryLink.repositoryRowId, repository.id),
          eq(githubRepositoryLink.projectId, input.projectId),
        );
  const removed = await database
    .delete(githubRepositoryLink)
    .where(scoped)
    .returning({ id: githubRepositoryLink.id });
  await reconcileWatchedRepositories(database, input.organizationId);
  return removed.length > 0;
}

export async function unlinkGithubRepositoryEverywhere(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly repositoryId: string },
): Promise<number> {
  const repository = await repositoryInWorkspace(database, input);
  const removed = await database
    .delete(githubRepositoryLink)
    .where(
      and(
        eq(githubRepositoryLink.organizationId, input.organizationId),
        eq(githubRepositoryLink.repositoryRowId, repository.id),
      ),
    )
    .returning({ id: githubRepositoryLink.id });
  await reconcileWatchedRepositories(database, input.organizationId);
  return removed.length;
}
