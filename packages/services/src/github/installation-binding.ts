import type { Transaction } from '@orbit/db';
import { githubInstallation, githubRepositorySync, integration } from '@orbit/db/schema';
import { and, eq } from 'drizzle-orm';
import { withinGithubReplacementBudget } from './installation-replacement-budget.ts';
import type { GithubInstallationRow } from './installations.ts';

export interface GithubRepositoryBinding {
  readonly organizationId: string;
  readonly installationRowId: string;
  readonly integrationId: string;
  readonly installationId: string;
  readonly repositorySyncId: string;
  readonly repositoryId: string;
}

export async function lockGithubInstallationSnapshot(
  database: Transaction,
  captured: GithubInstallationRow,
  deadline?: number,
): Promise<GithubInstallationRow | null> {
  const [parent] = await withinGithubReplacementBudget(database, deadline, () =>
    database
      .select({ id: integration.id })
      .from(integration)
      .where(
        and(
          eq(integration.id, captured.integrationId),
          eq(integration.organizationId, captured.organizationId),
          eq(integration.provider, 'github'),
          eq(integration.externalId, captured.installationId),
        ),
      )
      .for('update'),
  );
  if (parent === undefined) return null;
  const [current] = await withinGithubReplacementBudget(database, deadline, () =>
    database
      .select()
      .from(githubInstallation)
      .where(
        and(
          eq(githubInstallation.id, captured.id),
          eq(githubInstallation.organizationId, captured.organizationId),
          eq(githubInstallation.integrationId, captured.integrationId),
          eq(githubInstallation.installationId, captured.installationId),
          eq(githubInstallation.accountId, captured.accountId),
          eq(githubInstallation.accountType, captured.accountType),
        ),
      )
      .for('update'),
  );
  return current ?? null;
}

export async function lockGithubRepositoryBinding(
  database: Transaction,
  captured: GithubRepositoryBinding,
): Promise<typeof githubRepositorySync.$inferSelect | null> {
  const [parent] = await database
    .select({ id: integration.id })
    .from(integration)
    .where(
      and(
        eq(integration.id, captured.integrationId),
        eq(integration.organizationId, captured.organizationId),
        eq(integration.provider, 'github'),
        eq(integration.externalId, captured.installationId),
      ),
    )
    .for('update');
  if (parent === undefined) return null;
  const [installation] = await database
    .select({ id: githubInstallation.id })
    .from(githubInstallation)
    .where(
      and(
        eq(githubInstallation.id, captured.installationRowId),
        eq(githubInstallation.integrationId, captured.integrationId),
        eq(githubInstallation.organizationId, captured.organizationId),
        eq(githubInstallation.installationId, captured.installationId),
      ),
    )
    .for('update');
  if (installation === undefined) return null;
  const [watch] = await database
    .select()
    .from(githubRepositorySync)
    .where(
      and(
        eq(githubRepositorySync.id, captured.repositorySyncId),
        eq(githubRepositorySync.organizationId, captured.organizationId),
        eq(githubRepositorySync.integrationId, captured.integrationId),
        eq(githubRepositorySync.installationId, captured.installationId),
        eq(githubRepositorySync.repositoryId, captured.repositoryId),
      ),
    )
    .for('update');
  return watch ?? null;
}
