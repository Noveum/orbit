import type { Transaction } from '@orbit/db';
import {
  githubCheckActivity,
  githubCheckHeadContext,
  githubInstallation,
  githubRepository,
  githubRepositoryLink,
  githubRepositorySync,
  organization,
} from '@orbit/db/schema';
import { conflict } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { GithubDatabase } from './apply.ts';
import {
  assertGithubReplacementBudget,
  GITHUB_REPLACEMENT_TRANSACTION_BUDGET_MS,
  isGithubBindingConflict,
  withinGithubReplacementBudget,
} from './installation-replacement-budget.ts';

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

export async function removeGithubRepositorySyncs(
  database: GithubDatabase,
  condition: SQL | undefined,
  deadline?: number,
): Promise<number> {
  if (condition === undefined) throw new Error('A repository removal filter is required.');
  return await database.transaction(async (tx) => {
    const rows = await withinGithubReplacementBudget(tx, deadline, () =>
      tx
        .select({ id: githubRepositorySync.id })
        .from(githubRepositorySync)
        .where(condition)
        .orderBy(asc(githubRepositorySync.id))
        .for('update'),
    );
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return 0;
    await withinGithubReplacementBudget(tx, deadline, () =>
      tx
        .delete(githubCheckHeadContext)
        .where(inArray(githubCheckHeadContext.repositorySyncId, ids)),
    );
    await withinGithubReplacementBudget(tx, deadline, () =>
      tx.delete(githubCheckActivity).where(inArray(githubCheckActivity.repositorySyncId, ids)),
    );
    const removed = await withinGithubReplacementBudget(tx, deadline, () =>
      tx
        .delete(githubRepositorySync)
        .where(inArray(githubRepositorySync.id, ids))
        .returning({ id: githubRepositorySync.id }),
    );
    return removed.length;
  });
}

function watchedSnapshot(rows: readonly WatchedRow[]): string {
  return JSON.stringify(
    rows
      .map((row) => [
        row.repositoryId,
        row.integrationId,
        row.installationId,
        row.repositoryName,
        row.defaultBranch,
      ])
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

async function reconcileCapturedWatchedRows(
  tx: Transaction,
  captured: readonly WatchedRow[],
  organizationId: string,
  now: Date,
  deadline: number,
): Promise<number> {
  await withinGithubReplacementBudget(tx, deadline, () =>
    tx.execute(sql`select set_config('lock_timeout', '1000', true)`),
  );
  const [workspace] = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for('update', { noWait: true }),
  );
  if (workspace === undefined) return 0;
  const desired = await withinGithubReplacementBudget(tx, deadline, () =>
    desiredWatchedRows(tx, organizationId),
  );
  if (watchedSnapshot(captured) !== watchedSnapshot(desired))
    throw conflict('The GitHub connections changed. Select the repository again.', {
      details: { reason: 'github_replacement_conflict' },
    });
  const owned = await withinGithubReplacementBudget(tx, deadline, () =>
    catalogueRepositoryIds(tx, organizationId),
  );
  const keep = new Set(desired.map((row) => row.repositoryId));
  const drop = owned.filter((repositoryId) => !keep.has(repositoryId));
  if (drop.length !== 0)
    await removeGithubRepositorySyncs(
      tx,
      and(
        eq(githubRepositorySync.organizationId, organizationId),
        inArray(githubRepositorySync.repositoryId, drop),
      ),
      deadline,
    );
  if (desired.length === 0) return 0;
  await withinGithubReplacementBudget(tx, deadline, () =>
    tx
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
      }),
  );
  assertGithubReplacementBudget(deadline);
  return desired.length;
}

export async function reconcileWatchedRepositories(
  database: GithubDatabase,
  organizationId: string,
  now: Date = new Date(),
): Promise<number> {
  const captured = await desiredWatchedRows(database, organizationId);
  const deadline = performance.now() + GITHUB_REPLACEMENT_TRANSACTION_BUDGET_MS;
  try {
    return await database.transaction(async (tx) => {
      const [settings] = await tx.execute<{ lockTimeout: string; statementTimeout: string }>(
        sql`select current_setting('lock_timeout') as "lockTimeout", current_setting('statement_timeout') as "statementTimeout"`,
      );
      if (settings === undefined) throw new Error('Database timeout context is unavailable.');
      const result = await reconcileCapturedWatchedRows(
        tx,
        captured,
        organizationId,
        now,
        deadline,
      );
      await tx.execute(
        sql`select set_config('lock_timeout', ${settings.lockTimeout}, true), set_config('statement_timeout', ${settings.statementTimeout}, true)`,
      );
      return result;
    });
  } catch (error: unknown) {
    if (isGithubBindingConflict(error))
      throw conflict('The GitHub connections are busy. Select the repository again.', {
        details: { reason: 'github_replacement_conflict' },
      });
    throw error;
  }
}

export async function forgetWatchedRepositories(
  database: GithubDatabase,
  input: { readonly organizationId: string; readonly repositoryIds: readonly string[] },
): Promise<number> {
  if (input.repositoryIds.length === 0) return 0;
  return await removeGithubRepositorySyncs(
    database,
    and(
      eq(githubRepositorySync.organizationId, input.organizationId),
      inArray(githubRepositorySync.repositoryId, [...input.repositoryIds]),
    ),
  );
}
