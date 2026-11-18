import type { Transaction } from '@orbit/db';
import {
  githubCheckHeadReconciliation,
  githubInstallation,
  githubPullRequest,
  githubPullRequestReconciliation,
  githubRepositorySync,
  integration,
  member,
  organization,
} from '@orbit/db/schema';
import { conflict } from '@orbit/shared/errors';
import { assertCan, policyRole } from '@orbit/shared/policy';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { GithubDatabase } from './apply.ts';
import {
  assertGithubReplacementBudget,
  GITHUB_REPLACEMENT_TRANSACTION_BUDGET_MS,
  isGithubBindingConflict,
  withinGithubReplacementBudget,
} from './installation-replacement-budget.ts';
import type { GithubReplacementProof } from './installation-replacement-proof.ts';
import { type GithubInstallationRow, replaceGithubRepositories } from './installations.ts';

export interface GithubReplacementSnapshot {
  readonly installation: GithubInstallationRow;
  readonly watchedRepositoryIds: readonly string[];
}

function replacementConflict(): never {
  throw conflict('The GitHub connection changed. Reconnect again to verify its current state.', {
    details: { reason: 'github_replacement_conflict' },
  });
}

function assertReplacementActivated(): void {
  if (
    process.env['NODE_ENV'] === 'production' &&
    process.env['ORBIT_GITHUB_INSTALLATION_REPLACEMENT_ENABLED'] !== 'true'
  )
    throw conflict(
      'GitHub reconnection is temporarily unavailable. Try reconnecting again later.',
      {
        details: { reason: 'github_replacement_disabled' },
      },
    );
}

export async function captureGithubReplacementSnapshot(
  database: GithubDatabase,
  installation: GithubInstallationRow,
): Promise<GithubReplacementSnapshot> {
  const watched = await database
    .select({
      repositoryId: githubRepositorySync.repositoryId,
      integrationId: githubRepositorySync.integrationId,
      installationId: githubRepositorySync.installationId,
    })
    .from(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.organizationId, installation.organizationId),
        or(
          eq(githubRepositorySync.integrationId, installation.integrationId),
          eq(githubRepositorySync.installationId, installation.installationId),
        ),
      ),
    )
    .orderBy(asc(githubRepositorySync.repositoryId));
  if (
    watched.some(
      (row) =>
        row.integrationId !== installation.integrationId ||
        row.installationId !== installation.installationId,
    )
  )
    replacementConflict();
  return { installation, watchedRepositoryIds: watched.map((row) => row.repositoryId) };
}

async function assertReplacementIdle(
  tx: Transaction,
  repositoryIds: readonly string[],
  now: Date,
  deadline: number,
): Promise<void> {
  if (repositoryIds.length === 0) return;
  const heads = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ status: githubCheckHeadReconciliation.status })
      .from(githubCheckHeadReconciliation)
      .where(inArray(githubCheckHeadReconciliation.repositorySyncId, repositoryIds))
      .orderBy(asc(githubCheckHeadReconciliation.id))
      .for('update', { noWait: true }),
  );
  const pulls = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ claimedAt: githubPullRequest.historyRefreshClaimedAt })
      .from(githubPullRequest)
      .where(inArray(githubPullRequest.repositorySyncId, repositoryIds))
      .orderBy(asc(githubPullRequest.id))
      .for('update', { noWait: true }),
  );
  const reconciliations = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ status: githubPullRequestReconciliation.status })
      .from(githubPullRequestReconciliation)
      .where(inArray(githubPullRequestReconciliation.repositorySyncId, repositoryIds))
      .orderBy(asc(githubPullRequestReconciliation.id))
      .for('update', { noWait: true }),
  );
  if (
    heads.some((row) => row.status === 'processing') ||
    reconciliations.some((row) => row.status === 'processing') ||
    pulls.some(
      (row) => row.claimedAt !== null && row.claimedAt.getTime() >= now.getTime() - 120_000,
    )
  )
    replacementConflict();
}

function assertReplacementWatched(
  watched: readonly (typeof githubRepositorySync.$inferSelect)[],
  snapshot: GithubReplacementSnapshot,
  proof: GithubReplacementProof,
): void {
  const captured = snapshot.installation;
  const currentIds = watched.map((row) => row.repositoryId).sort();
  if (
    watched.some(
      (row) =>
        row.integrationId !== captured.integrationId ||
        row.installationId !== captured.installationId,
    ) ||
    JSON.stringify(currentIds) !== JSON.stringify([...snapshot.watchedRepositoryIds].sort())
  )
    replacementConflict();
  const provenIds = new Set(proof.repositories.map((row) => row.repositoryId));
  if (currentIds.some((id) => !provenIds.has(id))) replacementConflict();
}

async function assertReplacementManager(
  tx: Transaction,
  captured: GithubInstallationRow,
  connectedById: string,
  deadline: number,
): Promise<void> {
  const [workspace] = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ id: organization.id, deletionRequestedAt: organization.deletionRequestedAt })
      .from(organization)
      .where(eq(organization.id, captured.organizationId))
      .for('update', { noWait: true }),
  );
  const [membership] = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, captured.organizationId), eq(member.userId, connectedById)),
      )
      .for('update', { noWait: true }),
  );
  if (workspace === undefined) replacementConflict();
  if (workspace.deletionRequestedAt !== null)
    throw conflict('Workspace deletion is in progress.', {
      details: { reason: 'workspace_unavailable' },
    });
  assertCan(
    {
      organizationId: captured.organizationId,
      userId: connectedById,
      role: policyRole(membership?.role ?? 'guest'),
      teamIds: [],
    },
    'integration:manage',
  );
}

async function assertReplacementCandidates(
  tx: Transaction,
  captured: GithubInstallationRow,
  newInstallationId: string,
  deadline: number,
): Promise<void> {
  const sameAccount = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ id: githubInstallation.id })
      .from(githubInstallation)
      .where(
        and(
          eq(githubInstallation.organizationId, captured.organizationId),
          eq(githubInstallation.accountId, captured.accountId),
          eq(githubInstallation.accountType, captured.accountType),
        ),
      )
      .limit(2),
  );
  if (sameAccount.length !== 1 || sameAccount[0]?.id !== captured.id) replacementConflict();
  const target = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ id: githubInstallation.id })
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, newInstallationId))
      .limit(1),
  );
  const targetIntegration = await withinGithubReplacementBudget(tx, deadline, () =>
    tx
      .select({ id: integration.id })
      .from(integration)
      .where(and(eq(integration.provider, 'github'), eq(integration.externalId, newInstallationId)))
      .limit(1),
  );
  if (target.length !== 0 || targetIntegration.length !== 0) replacementConflict();
}

export async function adoptGithubInstallationReplacement(
  database: GithubDatabase,
  input: {
    readonly snapshot: GithubReplacementSnapshot;
    readonly proof: GithubReplacementProof;
    readonly connectedById: string;
    readonly now?: Date;
  },
): Promise<GithubInstallationRow> {
  const { installation: captured } = input.snapshot;
  const { installation: account } = input.proof;
  if (
    input.proof.previousInstallationId !== captured.installationId ||
    account.installationId === captured.installationId ||
    account.accountId !== captured.accountId ||
    account.accountType !== captured.accountType ||
    account.suspended
  )
    replacementConflict();
  const now = input.now ?? new Date();
  const deadline = performance.now() + GITHUB_REPLACEMENT_TRANSACTION_BUDGET_MS;
  try {
    return await database.transaction(async (tx) => {
      await withinGithubReplacementBudget(tx, deadline, () =>
        tx.execute(sql`select set_config('lock_timeout', '1000', true)`),
      );
      await assertReplacementManager(tx, captured, input.connectedById, deadline);
      assertReplacementActivated();
      const [parent] = await withinGithubReplacementBudget(tx, deadline, () =>
        tx
          .select()
          .from(integration)
          .where(eq(integration.id, captured.integrationId))
          .for('update', { noWait: true }),
      );
      const [current] = await withinGithubReplacementBudget(tx, deadline, () =>
        tx
          .select()
          .from(githubInstallation)
          .where(eq(githubInstallation.id, captured.id))
          .for('update', { noWait: true }),
      );
      if (
        parent === undefined ||
        current === undefined ||
        parent.organizationId !== captured.organizationId ||
        parent.provider !== 'github' ||
        parent.externalId !== captured.installationId ||
        current.organizationId !== captured.organizationId ||
        current.integrationId !== captured.integrationId ||
        current.installationId !== captured.installationId ||
        current.accountId !== captured.accountId ||
        current.accountType !== captured.accountType
      )
        replacementConflict();
      await assertReplacementCandidates(tx, captured, account.installationId, deadline);
      const watched = await withinGithubReplacementBudget(tx, deadline, () =>
        tx
          .select()
          .from(githubRepositorySync)
          .where(
            and(
              eq(githubRepositorySync.organizationId, captured.organizationId),
              or(
                eq(githubRepositorySync.integrationId, captured.integrationId),
                eq(githubRepositorySync.installationId, captured.installationId),
              ),
            ),
          )
          .orderBy(asc(githubRepositorySync.id))
          .for('update', { noWait: true }),
      );
      assertReplacementWatched(watched, input.snapshot, input.proof);
      await assertReplacementIdle(
        tx,
        watched.map((row) => row.id),
        now,
        deadline,
      );
      const parents = await withinGithubReplacementBudget(tx, deadline, () =>
        tx
          .update(integration)
          .set({
            externalId: account.installationId,
            connectedById: input.connectedById,
            updatedAt: now,
          })
          .where(
            and(
              eq(integration.id, parent.id),
              eq(integration.organizationId, captured.organizationId),
              eq(integration.provider, 'github'),
              eq(integration.externalId, captured.installationId),
            ),
          )
          .returning({ id: integration.id }),
      );
      const [adopted] = await withinGithubReplacementBudget(tx, deadline, () =>
        tx
          .update(githubInstallation)
          .set({
            installationId: account.installationId,
            accountLogin: account.accountLogin,
            accountId: account.accountId,
            accountType: account.accountType,
            repositorySelection: account.repositorySelection,
            status: 'active',
            connectedById: input.connectedById,
            updatedAt: now,
          })
          .where(
            and(
              eq(githubInstallation.id, captured.id),
              eq(githubInstallation.organizationId, captured.organizationId),
              eq(githubInstallation.integrationId, captured.integrationId),
              eq(githubInstallation.installationId, captured.installationId),
            ),
          )
          .returning(),
      );
      if (parents.length !== 1 || adopted === undefined) replacementConflict();
      if (watched.length !== 0) {
        const changed = await withinGithubReplacementBudget(tx, deadline, () =>
          tx
            .update(githubRepositorySync)
            .set({ installationId: account.installationId, updatedAt: now })
            .where(
              and(
                inArray(
                  githubRepositorySync.id,
                  watched.map((row) => row.id),
                ),
                eq(githubRepositorySync.organizationId, captured.organizationId),
                eq(githubRepositorySync.integrationId, captured.integrationId),
                eq(githubRepositorySync.installationId, captured.installationId),
              ),
            )
            .returning({ id: githubRepositorySync.id }),
        );
        if (changed.length !== watched.length) replacementConflict();
      }
      await replaceGithubRepositories(tx, {
        installation: adopted,
        repositories: input.proof.repositories,
        now,
        deadline,
      });
      assertGithubReplacementBudget(deadline);
      return adopted;
    });
  } catch (error: unknown) {
    if (isGithubBindingConflict(error)) replacementConflict();
    throw error;
  }
}
