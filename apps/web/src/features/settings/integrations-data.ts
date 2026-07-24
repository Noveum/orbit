import { db, desc, eq, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import { githubConnectReady, slackConnectReady } from '@/lib/env.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';

export interface LinkedRepository {
  readonly id: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly teamId: string;
  readonly enabled: boolean;
}

export interface ConnectedChannel {
  readonly channelId: string;
  readonly channelName: string;
  readonly teamId: string | null;
  readonly enabled: boolean;
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
  readonly slackConnected: boolean;
  readonly slackHasToken: boolean;
  readonly slackConnectEnabled: boolean;
  readonly channels: ConnectedChannel[];
  readonly teams: IntegrationTeam[];
}

function slackBotTokenFrom(credentials: unknown): string | null {
  if (typeof credentials !== 'object' || credentials === null) return null;
  const token = (credentials as Record<string, unknown>)['botToken'];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

export async function loadIntegrationSettings(principal: Principal): Promise<IntegrationSettings> {
  const [integrations, repositories, channels, teams] = await Promise.all([
    db
      .select({
        provider: schema.integration.provider,
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

  return {
    githubConnected: integrations.some((row) => row.provider === 'github'),
    githubConnectEnabled: githubConnectReady(),
    repositories,
    slackConnected: slackRow !== undefined,
    slackHasToken: slackToken !== null,
    slackConnectEnabled: slackConnectReady(),
    channels,
    teams,
  };
}
