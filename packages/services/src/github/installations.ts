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
import { lockGithubInstallationSnapshot } from './installation-binding.ts';
import { withinGithubReplacementBudget } from './installation-replacement-budget.ts';
import { forgetWatchedRepositories, removeGithubRepositorySyncs } from './watched.ts';

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
  readonly expectedAccountBindings?: readonly Pick<
    GithubInstallationRow,
    'id' | 'installationId' | 'integrationId'
  >[];
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

  if (input.expectedAccountBindings !== undefined) {
    const current = await database
      .select({
        id: githubInstallation.id,
        installationId: githubInstallation.installationId,
        integrationId: githubInstallation.integrationId,
      })
      .from(githubInstallation)
      .where(
        and(
          eq(githubInstallation.organizationId, organizationId),
          eq(githubInstallation.accountId, account.accountId),
          eq(githubInstallation.accountType, account.accountType),
        ),
      );
    const identity = (
      rows: readonly Pick<GithubInstallationRow, 'id' | 'installationId' | 'integrationId'>[],
    ) =>
      JSON.stringify(
        rows
          .map((row) => [row.id, row.installationId, row.integrationId])
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      );
    if (identity(current) !== identity(input.expectedAccountBindings))
      throw conflict(
        'The GitHub connection changed. Reconnect again to verify its current state.',
        { details: { reason: 'github_replacement_conflict' } },
      );
  }

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
  return await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: githubInstallation.id, integrationId: integration.id })
      .from(integration)
      .innerJoin(githubInstallation, eq(githubInstallation.integrationId, integration.id))
      .where(
        and(
          eq(integration.organizationId, input.organizationId),
          eq(githubInstallation.organizationId, input.organizationId),
          eq(githubInstallation.installationId, input.installationId),
        ),
      )
      .limit(1)
      .for('update');
    if (row === undefined) return false;
    await removeGithubRepositorySyncs(
      tx,
      and(
        eq(githubRepositorySync.organizationId, input.organizationId),
        eq(githubRepositorySync.integrationId, row.integrationId),
      ),
    );
    await tx.delete(githubInstallation).where(eq(githubInstallation.id, row.id));
    await tx.delete(integration).where(eq(integration.id, row.integrationId));
    return true;
  });
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

interface GithubCatalogueInput {
  readonly installation: GithubInstallationRow;
  readonly repositories: readonly GithubInstalledRepository[];
  readonly now?: Date;
  readonly deadline?: number;
}

async function propagateCurrentGithubRepositoryIdentities(
  database: Transaction,
  installation: GithubInstallationRow,
  repositories: readonly GithubRepositoryRow[],
  now: Date,
  deadline: number | undefined,
): Promise<void> {
  const facts = sql`jsonb_to_recordset(${JSON.stringify(repositories.map((row) => ({ repository_id: row.repositoryId, full_name: row.fullName, default_branch: row.defaultBranch })))}::jsonb) as incoming(repository_id text, full_name text, default_branch text)`;
  const watched = await withinGithubReplacementBudget(database, deadline, () =>
    database
      .update(githubRepositorySync)
      .set({
        repositoryName: sql`incoming.full_name`,
        defaultBranch: sql`incoming.default_branch`,
        updatedAt: now,
      })
      .from(facts)
      .where(
        and(
          eq(githubRepositorySync.organizationId, installation.organizationId),
          eq(githubRepositorySync.integrationId, installation.integrationId),
          eq(githubRepositorySync.installationId, installation.installationId),
          eq(githubRepositorySync.repositoryId, sql`incoming.repository_id`),
        ),
      )
      .returning({
        id: githubRepositorySync.id,
        repositoryId: githubRepositorySync.repositoryId,
        repositoryName: githubRepositorySync.repositoryName,
      }),
  );
  if (watched.length === 0) return;
  const ownedFacts = sql`jsonb_to_recordset(${JSON.stringify(watched.map((row) => ({ repository_sync_id: row.id, repository_id: row.repositoryId, full_name: row.repositoryName })))}::jsonb) as incoming(repository_sync_id text, repository_id text, full_name text)`;
  await withinGithubReplacementBudget(database, deadline, () =>
    database
      .update(githubPullRequest)
      .set({ repositoryName: sql`incoming.full_name` })
      .from(ownedFacts)
      .where(
        and(
          eq(githubPullRequest.organizationId, installation.organizationId),
          eq(githubPullRequest.repositorySyncId, sql`incoming.repository_sync_id`),
          eq(githubPullRequest.repositoryId, sql`incoming.repository_id`),
        ),
      ),
  );
}

async function persistCurrentGithubRepositories(
  database: Transaction,
  input: GithubCatalogueInput,
): Promise<GithubRepositoryRow[]> {
  if (input.repositories.length === 0) return [];
  const now = input.now ?? new Date();
  const rows = await withinGithubReplacementBudget(database, input.deadline, () =>
    database
      .insert(githubRepository)
      .values(input.repositories.map((entry) => repositoryValues(input.installation, entry)))
      .onConflictDoUpdate({
        target: [githubRepository.installationRowId, githubRepository.repositoryId],
        set: { ...REPOSITORY_FACTS, updatedAt: now },
      })
      .returning(),
  );
  await propagateCurrentGithubRepositoryIdentities(
    database,
    input.installation,
    rows,
    now,
    input.deadline,
  );
  return rows;
}

export async function upsertGithubRepositories(
  database: GithubDatabase,
  input: GithubCatalogueInput,
): Promise<GithubRepositoryRow[]> {
  if ('$client' in database)
    return await database.transaction((tx) => upsertGithubRepositories(tx, input));
  if ((await lockGithubInstallationSnapshot(database, input.installation, input.deadline)) === null)
    return [];
  return await persistCurrentGithubRepositories(database, input);
}

export async function replaceGithubRepositories(
  database: GithubDatabase,
  input: GithubCatalogueInput,
): Promise<GithubRepositoryRow[]> {
  if ('$client' in database)
    return await database.transaction((tx) => replaceGithubRepositories(tx, input));
  if ((await lockGithubInstallationSnapshot(database, input.installation, input.deadline)) === null)
    return [];
  const now = input.now ?? new Date();
  const kept = await persistCurrentGithubRepositories(database, { ...input, now });
  const keepIds = input.repositories.map((entry) => entry.repositoryId);
  const stale =
    keepIds.length === 0
      ? eq(githubRepository.installationRowId, input.installation.id)
      : and(
          eq(githubRepository.installationRowId, input.installation.id),
          notInArray(githubRepository.repositoryId, keepIds),
        );
  const dropped = await withinGithubReplacementBudget(database, input.deadline, () =>
    database
      .delete(githubRepository)
      .where(stale)
      .returning({ repositoryId: githubRepository.repositoryId }),
  );
  if (dropped.length !== 0)
    await removeGithubRepositorySyncs(
      database,
      and(
        eq(githubRepositorySync.organizationId, input.installation.organizationId),
        eq(githubRepositorySync.integrationId, input.installation.integrationId),
        eq(githubRepositorySync.installationId, input.installation.installationId),
        inArray(
          githubRepositorySync.repositoryId,
          dropped.map((row) => row.repositoryId),
        ),
      ),
      input.deadline,
    );
  await withinGithubReplacementBudget(database, input.deadline, () =>
    database
      .update(githubInstallation)
      .set({ repositoriesSyncedAt: now, updatedAt: now })
      .where(
        and(
          eq(githubInstallation.id, input.installation.id),
          eq(githubInstallation.installationId, input.installation.installationId),
          eq(githubInstallation.integrationId, input.installation.integrationId),
        ),
      ),
  );
  return kept;
}

export async function removeGithubRepositories(
  database: GithubDatabase,
  input: { readonly installationId: string; readonly repositoryIds: readonly string[] },
): Promise<number> {
  if (input.repositoryIds.length === 0) return 0;
  const [captured] = await database
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, input.installationId))
    .limit(1);
  if (captured === undefined) return 0;
  return await database.transaction(async (tx) => {
    const current = await lockGithubInstallationSnapshot(tx, captured);
    if (current === null) return 0;
    const removed = await tx
      .delete(githubRepository)
      .where(
        and(
          eq(githubRepository.organizationId, current.organizationId),
          eq(githubRepository.installationRowId, current.id),
          inArray(githubRepository.repositoryId, input.repositoryIds),
        ),
      )
      .returning({ repositoryId: githubRepository.repositoryId });
    if (removed.length !== 0)
      await removeGithubRepositorySyncs(
        tx,
        and(
          eq(githubRepositorySync.organizationId, current.organizationId),
          eq(githubRepositorySync.integrationId, current.integrationId),
          eq(githubRepositorySync.installationId, current.installationId),
          inArray(
            githubRepositorySync.repositoryId,
            removed.map((row) => row.repositoryId),
          ),
        ),
      );
    return removed.length;
  });
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

export async function updateGithubRepositoryFactsForInstallation(
  database: GithubDatabase,
  input: GithubRepositoryFacts & {
    readonly installation: GithubInstallationRow;
    readonly now?: Date;
  },
): Promise<number> {
  if ('$client' in database)
    return await database.transaction((tx) =>
      updateGithubRepositoryFactsForInstallation(tx, input),
    );
  if ((await lockGithubInstallationSnapshot(database, input.installation)) === null) return 0;
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
    .where(
      and(
        eq(githubRepository.organizationId, input.installation.organizationId),
        eq(githubRepository.installationRowId, input.installation.id),
        eq(githubRepository.repositoryId, input.repositoryId),
      ),
    )
    .returning();
  if (rows.length !== 0)
    await propagateCurrentGithubRepositoryIdentities(
      database,
      input.installation,
      rows,
      now,
      undefined,
    );
  return rows.length;
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
