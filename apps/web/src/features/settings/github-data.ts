import { and, asc, db, eq, isNull, schema } from '@orbit/db';
import { listGithubCatalogue, listGithubInstallations } from '@orbit/services';
import { assertCan, type Principal } from '@orbit/shared/policy';
import { githubAppConfig, githubConnectReady, githubDiscoveryReady } from '@/lib/env.ts';
import { refreshWorkspaceRepositories } from './github-connect.ts';
import type { GithubSettingsView } from './github-view.ts';

function manageUrlFor(accountType: string, accountLogin: string, installationId: string): string {
  if (accountType.toLowerCase() === 'organization') {
    return `https://github.com/organizations/${accountLogin}/settings/installations/${installationId}`;
  }
  return `https://github.com/settings/installations/${installationId}`;
}

export async function loadGithubSettings(
  principal: Principal,
  options: { readonly refresh?: boolean } = {},
): Promise<GithubSettingsView> {
  assertCan(principal, 'integration:manage');
  const connected = await listGithubInstallations(db, principal.organizationId);
  const refreshed =
    connected.length === 0
      ? 0
      : await refreshWorkspaceRepositories({
          installations: connected,
          force: options.refresh === true,
          config: githubAppConfig(),
        });
  const installations =
    refreshed > 0 ? await listGithubInstallations(db, principal.organizationId) : connected;

  const [repositories, projects] = await Promise.all([
    listGithubCatalogue(db, principal.organizationId),
    db
      .select({ id: schema.project.id, name: schema.project.name })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.organizationId, principal.organizationId),
          isNull(schema.project.archivedAt),
        ),
      )
      .orderBy(asc(schema.project.name)),
  ]);

  const counts = new Map<string, number>();
  for (const repository of repositories) {
    counts.set(repository.installationId, (counts.get(repository.installationId) ?? 0) + 1);
  }

  return {
    connected: installations.length > 0,
    connectEnabled: githubConnectReady(),
    discoveryEnabled: githubDiscoveryReady(),
    installations: installations.map((row) => ({
      installationId: row.installationId,
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      repositorySelection: row.repositorySelection,
      status: row.status,
      repositoryCount: counts.get(row.installationId) ?? 0,
      manageUrl: manageUrlFor(row.accountType, row.accountLogin, row.installationId),
    })),
    repositories,
    projects,
  };
}
