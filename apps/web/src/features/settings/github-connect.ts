import { and, db, eq, schema, sql } from '@orbit/db';
import {
  applyNormalizedGithubEvent,
  assertGithubIntegrationManager,
  bindGithubInstallation,
  exchangeGithubUserCode,
  fetchGithubInstallation,
  fetchGithubOpenPullRequests,
  fetchInstalledRepositories,
  type GithubInstallationRow,
  listUserInstallationIds,
  replaceGithubRepositories,
} from '@orbit/services';
import { forbidden, validationFailed } from '@orbit/shared/errors';
import type { GithubAppConfig } from '@/lib/env.ts';

export const GITHUB_REPOSITORY_CACHE_MS = 600_000;
export const GITHUB_BACKFILL_REPOSITORY_LIMIT = 5;

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
  await assertGithubIntegrationManager(db, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
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
  try {
    await backfillInstallationPullRequests(input);
  } catch (error) {
    console.error(
      `Could not backfill GitHub pull requests for installation ${input.installation.installationId}.`,
      error,
    );
  }
  return repositories.length;
}

async function backfillInstallationPullRequests(input: SyncRepositoriesInput): Promise<void> {
  const watched = await db
    .select({
      id: schema.githubRepositorySync.id,
      repositoryId: schema.githubRepositorySync.repositoryId,
      repositoryName: schema.githubRepositorySync.repositoryName,
    })
    .from(schema.githubRepositorySync)
    .where(
      and(
        eq(schema.githubRepositorySync.organizationId, input.installation.organizationId),
        eq(schema.githubRepositorySync.installationId, input.installation.installationId),
        eq(schema.githubRepositorySync.enabled, true),
      ),
    )
    .orderBy(sql`${schema.githubRepositorySync.pullRequestsBackfilledAt} asc nulls first`)
    .limit(GITHUB_BACKFILL_REPOSITORY_LIMIT);
  const backfilledAt = input.now ?? new Date();
  for (const repository of watched) {
    try {
      const pullRequests = await fetchGithubOpenPullRequests({
        appId: input.config.appId,
        privateKey: input.config.privateKey,
        installationId: input.installation.installationId,
        repository: repository.repositoryName,
        ...fetchOverride(input),
      });
      for (const pullRequest of pullRequests) {
        await db.transaction(async (tx) => {
          await applyNormalizedGithubEvent(tx, {
            organizationId: input.installation.organizationId,
            event: {
              action: 'synchronize',
              repository: {
                externalId: repository.repositoryId,
                fullName: repository.repositoryName,
              },
              pullRequest: {
                externalId: pullRequest.externalId,
                nodeId: pullRequest.nodeId,
                number: pullRequest.number,
                title: pullRequest.title,
                body: pullRequest.body,
                url: pullRequest.url,
                headRef: pullRequest.headRef,
                headSha: pullRequest.headSha,
                baseRef: pullRequest.baseRef,
                draft: pullRequest.draft,
                merged: false,
                closed: false,
                author: pullRequest.author,
                createdAt: pullRequest.createdAt,
                updatedAt: pullRequest.updatedAt,
              },
              review: null,
              requestedReviewer: null,
              checks: null,
              comment: null,
              activity: {
                externalId:
                  pullRequest.externalId.length === 0
                    ? `pull_request:${pullRequest.number}:backfill`
                    : `pull_request:${pullRequest.externalId}`,
                type: 'pull_request',
                body: '',
                url: pullRequest.url,
                state: 'synchronize',
                path: null,
                line: null,
                occurredAt: pullRequest.updatedAt,
              },
              sender: pullRequest.author,
            },
            ...(input.now === undefined ? {} : { now: input.now }),
          });
        });
      }
      await db
        .update(schema.githubRepositorySync)
        .set({ pullRequestsBackfilledAt: backfilledAt })
        .where(eq(schema.githubRepositorySync.id, repository.id));
    } catch (error) {
      console.error(`Could not backfill ${repository.repositoryName}.`, error);
    }
  }
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
