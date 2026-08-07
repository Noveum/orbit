import { db } from '@orbit/db';
import {
  bindGithubInstallation,
  exchangeGithubUserCode,
  fetchGithubInstallation,
  fetchInstalledRepositories,
  type GithubInstallationRow,
  listUserInstallationIds,
  replaceGithubRepositories,
} from '@orbit/services';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import type { GithubAppConfig } from '@/lib/env.ts';

export const GITHUB_REPOSITORY_CACHE_MS = 600_000;

export interface GithubConnectDeps {
  readonly config: GithubAppConfig;
  readonly fetch?: typeof globalThis.fetch;
}

function fetchOverride(deps: GithubConnectDeps): { fetch?: typeof globalThis.fetch } {
  return deps.fetch === undefined ? {} : { fetch: deps.fetch };
}

function discoveryReady(config: GithubAppConfig): boolean {
  return config.appId.length > 0 && config.privateKey.length > 0;
}

export interface CompleteInstallInput extends GithubConnectDeps {
  readonly organizationId: string;
  readonly userId: string;
  readonly installationId: string;
  readonly code: string;
  readonly now?: Date;
}

async function assertUserControlsInstallation(input: CompleteInstallInput): Promise<void> {
  if (input.code.trim().length === 0) {
    throw forbidden('That GitHub callback carried no proof that you control the installation.');
  }
  if (input.config.clientId.length === 0 || input.config.clientSecret.length === 0) {
    throw validationFailed(
      'The GitHub App has no client credentials, so Orbit cannot check who is connecting.',
    );
  }
  const overrides = fetchOverride(input);
  const userToken = await exchangeGithubUserCode({
    clientId: input.config.clientId,
    clientSecret: input.config.clientSecret,
    code: input.code,
    ...overrides,
  });
  const reachable = await listUserInstallationIds({ userToken, ...overrides });
  if (!reachable.includes(input.installationId)) {
    throw forbidden('You do not have access to that GitHub installation.');
  }
}

export async function completeGithubInstall(
  input: CompleteInstallInput,
): Promise<GithubInstallationRow> {
  if (!discoveryReady(input.config)) {
    throw validationFailed('The GitHub App is not configured yet.');
  }
  await assertUserControlsInstallation(input);

  const account = await fetchGithubInstallation({
    appId: input.config.appId,
    privateKey: input.config.privateKey,
    installationId: input.installationId,
    ...fetchOverride(input),
  });

  const installation = await db.transaction(async (tx) =>
    bindGithubInstallation(tx, {
      organizationId: input.organizationId,
      connectedById: input.userId,
      account,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
  );

  await syncInstallationRepositories({
    installation,
    config: input.config,
    ...fetchOverride(input),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  return installation;
}

export interface SyncRepositoriesInput extends GithubConnectDeps {
  readonly installation: GithubInstallationRow;
  readonly now?: Date;
}

export async function syncInstallationRepositories(input: SyncRepositoriesInput): Promise<number> {
  const repositories = await fetchInstalledRepositories({
    appId: input.config.appId,
    privateKey: input.config.privateKey,
    installationId: input.installation.installationId,
    ...fetchOverride(input),
  });
  await db.transaction(async (tx) =>
    replaceGithubRepositories(tx, {
      installation: input.installation,
      repositories,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
  );
  return repositories.length;
}

export function repositoriesAreStale(
  installation: GithubInstallationRow,
  now: Date = new Date(),
): boolean {
  if (installation.status !== 'active') return false;
  const synced = installation.repositoriesSyncedAt;
  if (synced === null) return true;
  return now.getTime() - synced.getTime() > GITHUB_REPOSITORY_CACHE_MS;
}

export interface RefreshInput extends GithubConnectDeps {
  readonly installations: readonly GithubInstallationRow[];
  readonly force: boolean;
  readonly now?: Date;
}

export async function refreshWorkspaceRepositories(input: RefreshInput): Promise<number> {
  if (!discoveryReady(input.config)) return 0;
  const now = input.now ?? new Date();
  let refreshed = 0;
  for (const installation of input.installations) {
    if (installation.status !== 'active') continue;
    if (!(input.force || repositoriesAreStale(installation, now))) continue;
    try {
      await syncInstallationRepositories({
        installation,
        config: input.config,
        ...fetchOverride(input),
        now,
      });
      refreshed += 1;
    } catch (error) {
      console.error(
        `Could not refresh repositories for GitHub installation ${installation.installationId}.`,
        error,
      );
    }
  }
  return refreshed;
}
