import { db, desc, eq, schema } from '@orbit/db';
import { fetchInstalledRepositories, SlackClient } from '@orbit/services';
import type { Principal } from '@orbit/shared/policy';
import {
  githubAppConfig,
  githubConnectReady,
  githubDiscoveryReady,
  slackConnectReady,
} from '@/lib/env.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export interface LinkedRepository {
  readonly id: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly teamId: string;
  readonly enabled: boolean;
}

export interface AvailableRepository {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly defaultBranch: string;
  readonly installationId: string;
}

export interface ConnectedChannel {
  readonly channelId: string;
  readonly channelName: string;
  readonly teamId: string | null;
  readonly enabled: boolean;
}

export interface AvailableChannel {
  readonly channelId: string;
  readonly channelName: string;
}

export interface IntegrationTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface IntegrationSettings {
  readonly githubConnected: boolean;
  readonly githubConnectEnabled: boolean;
  readonly repositories: LinkedRepository[];
  readonly availableRepositories: AvailableRepository[];
  readonly githubReposError: boolean;
  readonly slackConnected: boolean;
  readonly slackHasToken: boolean;
  readonly slackConnectEnabled: boolean;
  readonly channels: ConnectedChannel[];
  readonly availableChannels: AvailableChannel[];
  readonly slackChannelsError: boolean;
  readonly teams: IntegrationTeam[];
}

function slackBotTokenFrom(credentials: unknown): string | null {
  if (typeof credentials !== 'object' || credentials === null) return null;
  const token = (credentials as Record<string, unknown>)['botToken'];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

async function discoverRepositories(
  installationId: string | null,
): Promise<{ repositories: AvailableRepository[]; error: boolean }> {
  if (installationId === null || !githubDiscoveryReady()) {
    return { repositories: [], error: false };
  }
  const config = githubAppConfig();
  try {
    const repositories = await fetchInstalledRepositories({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId,
    });
    return {
      repositories: repositories.map((repository) => ({ ...repository, installationId })),
      error: false,
    };
  } catch (error) {
    console.error('Could not list GitHub repositories for the settings page.', error);
    return { repositories: [], error: true };
  }
}

async function discoverChannels(
  token: string | null,
): Promise<{ channels: AvailableChannel[]; error: boolean }> {
  if (token === null) return { channels: [], error: false };
  try {
    const conversations = await new SlackClient({ token }).listConversations();
    return {
      channels: conversations.channels.map((channel) => ({
        channelId: channel.id,
        channelName: channel.name,
      })),
      error: false,
    };
  } catch (error) {
    console.error('Could not list Slack channels for the settings page.', error);
    return { channels: [], error: true };
  }
}

export async function loadIntegrationSettings(principal: Principal): Promise<IntegrationSettings> {
  const [integrations, repositories, channels, teams] = await Promise.all([
    db
      .select({
        provider: schema.integration.provider,
        externalId: schema.integration.externalId,
        credentials: schema.integration.credentials,
      })
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, principal.organizationId))
      .orderBy(desc(schema.integration.createdAt)),
    db
      .select({
        id: schema.githubRepositorySync.id,
        repositoryId: schema.githubRepositorySync.repositoryId,
        repositoryName: schema.githubRepositorySync.repositoryName,
        teamId: schema.githubRepositorySync.teamId,
        enabled: schema.githubRepositorySync.enabled,
      })
      .from(schema.githubRepositorySync)
      .where(eq(schema.githubRepositorySync.organizationId, principal.organizationId))
      .orderBy(desc(schema.githubRepositorySync.createdAt)),
    db
      .select({
        channelId: schema.slackChannelSync.channelId,
        channelName: schema.slackChannelSync.channelName,
        teamId: schema.slackChannelSync.teamId,
        enabled: schema.slackChannelSync.enabled,
      })
      .from(schema.slackChannelSync)
      .where(eq(schema.slackChannelSync.organizationId, principal.organizationId)),
    listTeamsForPrincipal(principal),
  ]);

  const slackRow = integrations.find((row) => row.provider === 'slack');
  const slackToken = slackRow === undefined ? null : slackBotTokenFrom(slackRow.credentials);
  const installationId =
    integrations.find((row) => row.provider === 'github' && /^\d+$/.test(row.externalId))
      ?.externalId ?? null;

  const [repos, channelList] = await Promise.all([
    discoverRepositories(installationId),
    discoverChannels(slackToken),
  ]);

  return {
    githubConnected: integrations.some((row) => row.provider === 'github'),
    githubConnectEnabled: githubConnectReady(),
    repositories,
    availableRepositories: repos.repositories,
    githubReposError: repos.error,
    slackConnected: slackRow !== undefined,
    slackHasToken: slackToken !== null,
    slackConnectEnabled: slackConnectReady(),
    channels,
    availableChannels: channelList.channels,
    slackChannelsError: channelList.error,
    teams,
  };
}
