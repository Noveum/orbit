import { and, db, desc, eq, schema } from '@orbit/db';
import { can, type Principal } from '@orbit/shared/policy';
import { slackConnectReady } from '@/lib/env.ts';
import { listTeamsForPrincipal } from '@/lib/workspace.ts';
import { loadGithubSettings } from './github-data.ts';
import type { GithubSettingsView } from './github-view.ts';

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
  readonly github: GithubSettingsView;
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

const WITHHELD: IntegrationSettings = {
  github: {
    connected: false,
    connectEnabled: false,
    discoveryEnabled: false,
    installations: [],
    repositories: [],
    projects: [],
  },
  slackConnected: false,
  slackHasToken: false,
  slackConnectEnabled: false,
  channels: [],
  teams: [],
};

export async function loadIntegrationSettings(principal: Principal): Promise<IntegrationSettings> {
  if (!can(principal, 'integration:manage')) return WITHHELD;

  const [github, integrations, channels, teams] = await Promise.all([
    loadGithubSettings(principal),
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
    github,
    slackConnected: slackRow !== undefined,
    slackHasToken: slackToken !== null,
    slackConnectEnabled: slackConnectReady(),
    channels,
    teams,
  };
}

export interface GithubDeliveryView {
  readonly id: string;
  readonly event: string;
  readonly status: string;
  readonly reason: string | null;
  readonly receivedAt: string;
}

const DELIVERY_LIMIT = 20;

export async function loadGithubDeliveries(
  principal: Principal,
): Promise<readonly GithubDeliveryView[]> {
  if (!can(principal, 'integration:manage')) return [];
  const rows = await db
    .select({
      id: schema.webhookDelivery.id,
      event: schema.webhookDelivery.event,
      status: schema.webhookDelivery.status,
      error: schema.webhookDelivery.error,
      createdAt: schema.webhookDelivery.createdAt,
    })
    .from(schema.webhookDelivery)
    .where(
      and(
        eq(schema.webhookDelivery.provider, 'github'),
        eq(schema.webhookDelivery.organizationId, principal.organizationId),
      ),
    )
    .orderBy(desc(schema.webhookDelivery.createdAt))
    .limit(DELIVERY_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    status: row.status,
    reason: row.error,
    receivedAt: row.createdAt.toISOString(),
  }));
}
