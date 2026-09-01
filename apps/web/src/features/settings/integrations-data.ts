import { and, count, db, desc, eq, schema } from '@orbit/db';
import { hasSlackBotToken } from '@orbit/services/slack/credentials';
import { resolveSlackContext, slackUserMappingSyncReady } from '@orbit/services/slack/dispatch';
import { can, type Principal } from '@orbit/shared/policy';
import { slackConnectReady } from '@/lib/env.ts';
import { slackIntegrationEnabledForOrganization } from '@/lib/integrations/slack-capability.ts';
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

export interface SlackIntegrationSettings {
  readonly slackConnected: boolean;
  readonly slackHasToken: boolean;
  readonly slackConnectEnabled: boolean;
  readonly channels: ConnectedChannel[];
  readonly teams: IntegrationTeam[];
  readonly memberSync: {
    readonly eligible: number;
    readonly mapped: number;
    readonly ready: boolean;
  };
}

export interface IntegrationSettings {
  readonly github: GithubSettingsView;
  readonly slack?: SlackIntegrationSettings;
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
};

export async function loadIntegrationSettings(principal: Principal): Promise<IntegrationSettings> {
  if (!can(principal, 'integration:manage')) return WITHHELD;

  const github = await loadGithubSettings(principal);
  if (!slackIntegrationEnabledForOrganization(principal.organizationId)) return { github };

  const [slackRows, teams, slackContext] = await Promise.all([
    db
      .select({
        id: schema.integration.id,
        credentials: schema.integration.credentials,
        config: schema.integration.config,
      })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, principal.organizationId),
          eq(schema.integration.provider, 'slack'),
          eq(schema.integration.externalId, 'default'),
        ),
      )
      .limit(1),
    listTeamsForPrincipal(principal),
    resolveSlackContext(db, principal.organizationId, 'default'),
  ]);

  const slackRow = slackRows[0];
  const [channels, memberSync] = await Promise.all([
    slackRow === undefined
      ? Promise.resolve([])
      : db
          .select({
            channelId: schema.slackChannelSync.channelId,
            channelName: schema.slackChannelSync.channelName,
            teamId: schema.slackChannelSync.teamId,
            enabled: schema.slackChannelSync.enabled,
          })
          .from(schema.slackChannelSync)
          .where(
            and(
              eq(schema.slackChannelSync.organizationId, principal.organizationId),
              eq(schema.slackChannelSync.integrationId, slackRow.id),
            ),
          ),
    loadSlackMemberSync(principal.organizationId, slackRow?.id),
  ]);
  return {
    github,
    slack: {
      slackConnected: slackRow !== undefined,
      slackHasToken: slackRow !== undefined && hasSlackBotToken(slackRow.credentials),
      slackConnectEnabled: slackConnectReady(),
      channels,
      teams,
      memberSync: {
        ...memberSync,
        ready: slackUserMappingSyncReady({
          context: slackContext,
          slackTeamId: slackRow?.config['slackTeamId'],
        }),
      },
    },
  };
}

async function loadSlackMemberSync(
  organizationId: string,
  integrationId: string | undefined,
): Promise<{ readonly eligible: number; readonly mapped: number }> {
  if (integrationId === undefined) {
    const [summary] = await db
      .select({ eligible: count(schema.member.userId) })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId));
    return { eligible: summary?.eligible ?? 0, mapped: 0 };
  }
  const [summary] = await db
    .select({
      eligible: count(schema.member.userId),
      mapped: count(schema.slackUserMapping.id),
    })
    .from(schema.member)
    .leftJoin(
      schema.slackUserMapping,
      and(
        eq(schema.slackUserMapping.organizationId, organizationId),
        eq(schema.slackUserMapping.integrationId, integrationId),
        eq(schema.slackUserMapping.userId, schema.member.userId),
      ),
    )
    .where(eq(schema.member.organizationId, organizationId));
  return { eligible: summary?.eligible ?? 0, mapped: summary?.mapped ?? 0 };
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
