import type { Transaction } from '@orbit/db';
import {
  githubInstallation,
  githubPullRequest,
  githubRepository,
  githubRepositorySync,
  integration,
  member,
  organization,
} from '@orbit/db/schema';
import { ORG_ROLES, type OrgRole } from '@orbit/shared/constants';
import { conflict, notFound } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { GithubInstallationAccount, GithubInstalledRepository } from './app.ts';
import type { GithubDatabase } from './apply.ts';
import { forgetWatchedRepositories } from './watched.ts';

export type GithubInstallationRow = typeof githubInstallation.$inferSelect;
export type GithubRepositoryRow = typeof githubRepository.$inferSelect;

export const GITHUB_INSTALLATION_STATUSES = ['active', 'suspended'] as const;
export type GithubInstallationStatus = (typeof GITHUB_INSTALLATION_STATUSES)[number];

const CLAIMED_ELSEWHERE =
  'That GitHub installation is already connected to another Orbit workspace.';

export interface BindInstallationInput {
  readonly organizationId: string;
  readonly connectedById: string;
  readonly account: GithubInstallationAccount;
  readonly now?: Date;
}

export async function assertGithubIntegrationManager(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly userId: string },
): Promise<void> {
  const [workspace] = await database
    .select({ deletionRequestedAt: organization.deletionRequestedAt })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1);
  if (workspace !== undefined) assertWorkspaceAvailable(workspace.deletionRequestedAt);
  const [membership] = await database
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1);
  assertIntegrationManager(input, membership?.role);
}

async function assertGithubIntegrationManagerForUpdate(
  database: Transaction,
  input: { readonly organizationId: string; readonly userId: string },
): Promise<void> {
  const [workspace] = await database
    .select({ deletionRequestedAt: organization.deletionRequestedAt })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
    .for('update');
  if (workspace !== undefined) assertWorkspaceAvailable(workspace.deletionRequestedAt);
  const [membership] = await database
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1)
    .for('update');
  assertIntegrationManager(input, membership?.role);
}

function assertWorkspaceAvailable(deletionRequestedAt: Date | null): void {
  if (deletionRequestedAt !== null) {
    throw conflict('Workspace deletion is in progress.', {
      details: { reason: 'workspace_unavailable' },
    });
  }
}

function assertIntegrationManager(
  input: { readonly organizationId: string; readonly userId: string },
  role: string | undefined,
): void {
  assertCan(
    {
      organizationId: input.organizationId,
      userId: input.userId,
      role: organizationRole(role),
      teamIds: [],
    },
    'integration:manage',
  );
}

function organizationRole(role: string | undefined): OrgRole {
  return ORG_ROLES.find((candidate) => candidate === role) ?? 'guest';
}

export async function bindGithubInstallation(
  database: Transaction,
  input: BindInstallationInput,
): Promise<GithubInstallationRow> {
  const { organizationId, account } = input;
  const now = input.now ?? new Date();

  await assertGithubIntegrationManagerForUpdate(database, {
    organizationId,
    userId: input.connectedById,
  });

  const [claimed] = await database
    .select({ organizationId: githubInstallation.organizationId })
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, account.installationId))
    .limit(1);
  if (claimed !== undefined && claimed.organizationId !== organizationId) {
    throw conflict(CLAIMED_ELSEWHERE, {
      details: { reason: 'github_installation_claimed' },
    });
  }

  const integrationId = await ensureIntegrationRow(database, {
    organizationId,
    externalId: account.installationId,
    connectedById: input.connectedById,
    now,
  });

  const facts = {
    integrationId,
    accountLogin: account.accountLogin,
    accountId: account.accountId,
    accountType: account.accountType,
    repositorySelection: account.repositorySelection,
    status: account.suspended ? 'suspended' : 'active',
    connectedById: input.connectedById,
  };

  const [bound] = await database
    .insert(githubInstallation)
    .values({
      id: randomUUIDv7(),
      organizationId,
      installationId: account.installationId,
      ...facts,
    })
    .onConflictDoUpdate({
      target: githubInstallation.installationId,
      set: { ...facts, updatedAt: now },
      setWhere: eq(githubInstallation.organizationId, organizationId),
    })
    .returning();
  if (bound === undefined) {
    throw conflict(CLAIMED_ELSEWHERE, {
      details: { reason: 'github_installation_claimed' },
    });
  }
  return bound;
}

async function ensureIntegrationRow(
  database: GithubDatabase,
  input: {
    readonly organizationId: string;
    readonly externalId: string;
    readonly connectedById: string;
    readonly now: Date;
  },
): Promise<string> {
  const [row] = await database
    .insert(integration)
    .values({
      id: randomUUIDv7(),
      organizationId: input.organizationId,
      provider: 'github',
      externalId: input.externalId,
      connectedById: input.connectedById,
    })
    .onConflictDoUpdate({
      target: [integration.organizationId, integration.provider, integration.externalId],
      set: { connectedById: input.connectedById, updatedAt: input.now },
    })
    .returning({ id: integration.id });
  if (row === undefined) throw notFound('Could not record the GitHub integration.');
  return row.id;
}

export async function listGithubInstallations(
  database: GithubDatabase,
  organizationId: string,
): Promise<GithubInstallationRow[]> {
  return await database
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.organizationId, organizationId))
    .orderBy(asc(githubInstallation.accountLogin), asc(githubInstallation.createdAt));
}

export async function findGithubInstallation(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly installationId: string },
): Promise<GithubInstallationRow | null> {
  const [row] = await database
    .select()
    .from(githubInstallation)
    .where(
      and(
        eq(githubInstallation.organizationId, input.organizationId),
        eq(githubInstallation.installationId, input.installationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findGithubInstallationAnywhere(
  database: GithubDatabase,
  installationId: string,
): Promise<GithubInstallationRow | null> {
  const [row] = await database
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1);
  return row ?? null;
}

export async function setGithubInstallationStatus(
  database: GithubDatabase,
  input: {
    readonly installationId: string;
    readonly status: GithubInstallationStatus;
    readonly now?: Date;
  },
): Promise<number> {
  const rows = await database
    .update(githubInstallation)
    .set({ status: input.status, updatedAt: input.now ?? new Date() })
    .where(eq(githubInstallation.installationId, input.installationId))
    .returning({ id: githubInstallation.id });
  return rows.length;
}

export async function removeGithubInstallation(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly installationId: string },
): Promise<boolean> {
  const [row] = await database
    .select({ id: githubInstallation.id, integrationId: githubInstallation.integrationId })
    .from(githubInstallation)
    .where(
      and(
        eq(githubInstallation.organizationId, input.organizationId),
        eq(githubInstallation.installationId, input.installationId),
      ),
    )
    .limit(1);
  if (row === undefined) return false;
  await database.delete(githubInstallation).where(eq(githubInstallation.id, row.id));
  await database.delete(integration).where(eq(integration.id, row.integrationId));
  return true;
}

export async function purgeGithubInstallation(
  database: GithubDatabase,
  installationId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ organizationId: githubInstallation.organizationId })
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1);
  if (row === undefined) return false;
  return await removeGithubInstallation(database, {
    organizationId: row.organizationId,
    installationId,
  });
}

function repositoryValues(
  installation: GithubInstallationRow,
  repository: GithubInstalledRepository,
) {
  return {
    id: randomUUIDv7(),
    organizationId: installation.organizationId,
    installationRowId: installation.id,
    repositoryId: repository.repositoryId,
    fullName: repository.repositoryName,
    name: repository.name,
    ownerLogin: repository.ownerLogin,
    private: repository.private,
    archived: repository.archived,
    defaultBranch: repository.defaultBranch,
    htmlUrl: repository.htmlUrl,
  };
}

const REPOSITORY_FACTS = {
  fullName: sql`excluded.full_name`,
  name: sql`excluded.name`,
  ownerLogin: sql`excluded.owner_login`,
  private: sql`excluded.private`,
  archived: sql`excluded.archived`,
  defaultBranch: sql`excluded.default_branch`,
  htmlUrl: sql`excluded.html_url`,
};

async function propagateGithubRepositoryIdentity(
  database: GithubDatabase,
  input: {
    readonly organizationId: string;
    readonly repositoryId: string;
    readonly repositoryName: string;
    readonly defaultBranch: string;
    readonly now: Date;
  },
): Promise<void> {
  await database
    .update(githubRepositorySync)
    .set({
      repositoryName: input.repositoryName,
      defaultBranch: input.defaultBranch,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(githubRepositorySync.organizationId, input.organizationId),
        eq(githubRepositorySync.repositoryId, input.repositoryId),
      ),
    );
  await database
    .update(githubPullRequest)
    .set({ repositoryName: input.repositoryName })
    .where(
      and(
        eq(githubPullRequest.organizationId, input.organizationId),
        eq(githubPullRequest.repositoryId, input.repositoryId),
      ),
    );
}

export async function upsertGithubRepositories(
  database: GithubDatabase,
  input: {
    readonly installation: GithubInstallationRow;
    readonly repositories: readonly GithubInstalledRepository[];
    readonly now?: Date;
  },
): Promise<GithubRepositoryRow[]> {
  if (input.repositories.length === 0) return [];
  const now = input.now ?? new Date();
  const rows = await database
    .insert(githubRepository)
    .values(input.repositories.map((entry) => repositoryValues(input.installation, entry)))
    .onConflictDoUpdate({
      target: [githubRepository.installationRowId, githubRepository.repositoryId],
      set: { ...REPOSITORY_FACTS, updatedAt: now },
    })
    .returning();
  for (const row of rows) {
    await propagateGithubRepositoryIdentity(database, {
      organizationId: row.organizationId,
      repositoryId: row.repositoryId,
      repositoryName: row.fullName,
      defaultBranch: row.defaultBranch,
      now,
    });
  }
  return rows;
}

export async function replaceGithubRepositories(
  database: GithubDatabase,
  input: {
    readonly installation: GithubInstallationRow;
    readonly repositories: readonly GithubInstalledRepository[];
    readonly now?: Date;
  },
): Promise<GithubRepositoryRow[]> {
  const now = input.now ?? new Date();
  const kept = await upsertGithubRepositories(database, { ...input, now });
  const keepIds = input.repositories.map((entry) => entry.repositoryId);
  const stale =
    keepIds.length === 0
      ? eq(githubRepository.installationRowId, input.installation.id)
      : and(
          eq(githubRepository.installationRowId, input.installation.id),
          notInArray(githubRepository.repositoryId, keepIds),
        );
  const dropped = await database
    .delete(githubRepository)
    .where(stale)
    .returning({ repositoryId: githubRepository.repositoryId });
  await forgetWatchedRepositories(database, {
    organizationId: input.installation.organizationId,
    repositoryIds: dropped.map((row) => row.repositoryId),
  });
  await database
    .update(githubInstallation)
    .set({ repositoriesSyncedAt: now, updatedAt: now })
    .where(eq(githubInstallation.id, input.installation.id));
  return kept;
}

export async function removeGithubRepositories(
  database: GithubDatabase,
  input: { readonly installationId: string; readonly repositoryIds: readonly string[] },
): Promise<number> {
  if (input.repositoryIds.length === 0) return 0;
  const [installation] = await database
    .select({ id: githubInstallation.id, organizationId: githubInstallation.organizationId })
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, input.installationId))
    .limit(1);
  if (installation === undefined) return 0;
  const removed = await database
    .delete(githubRepository)
    .where(
      and(
        eq(githubRepository.installationRowId, installation.id),
        inArray(githubRepository.repositoryId, [...input.repositoryIds]),
      ),
    )
    .returning({ repositoryId: githubRepository.repositoryId });
  await forgetWatchedRepositories(database, {
    organizationId: installation.organizationId,
    repositoryIds: removed.map((row) => row.repositoryId),
  });
  return removed.length;
}

export interface GithubRepositoryFacts {
  readonly repositoryId: string;
  readonly fullName: string;
  readonly name: string;
  readonly ownerLogin: string;
  readonly private: boolean;
  readonly archived: boolean;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
}

export async function updateGithubRepositoryFacts(
  database: GithubDatabase,
  input: GithubRepositoryFacts & { readonly now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  const rows = await database
    .update(githubRepository)
    .set({
      fullName: input.fullName,
      name: input.name,
      ownerLogin: input.ownerLogin,
      private: input.private,
      archived: input.archived,
      defaultBranch: input.defaultBranch,
      htmlUrl: input.htmlUrl,
      updatedAt: now,
    })
    .where(eq(githubRepository.repositoryId, input.repositoryId))
    .returning({ organizationId: githubRepository.organizationId });
  for (const row of rows) {
    await propagateGithubRepositoryIdentity(database, {
      organizationId: row.organizationId,
      repositoryId: input.repositoryId,
      repositoryName: input.fullName,
      defaultBranch: input.defaultBranch,
      now,
    });
  }
  return rows.length;
}

export async function deleteGithubRepositoryEverywhere(
  database: GithubDatabase,
  repositoryId: string,
): Promise<number> {
  const rows = await database
    .delete(githubRepository)
    .where(eq(githubRepository.repositoryId, repositoryId))
    .returning({ organizationId: githubRepository.organizationId });
  for (const row of rows) {
    await forgetWatchedRepositories(database, {
      organizationId: row.organizationId,
      repositoryIds: [repositoryId],
    });
  }
  return rows.length;
}
