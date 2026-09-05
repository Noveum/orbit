import { and, db, eq, schema } from '@orbit/db';
import {
  connectCanonicalSlackChannel,
  disconnectSlackChannel,
  isSlackReauthorizationError,
  listSlackConversations,
  SlackApiError,
  syncSlackUserMappings,
} from '@orbit/services';
import { hasSlackBotToken } from '@orbit/services/slack/credentials';
import { conflict, rateLimited, validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { slackIntegrationActionSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';
import {
  slackIntegrationEnabledForOrganization,
  slackIntegrationUnavailable,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';
import { assertTeamInWorkspace } from '@/lib/workspace.ts';

export async function GET(): Promise<Response> {
  if (!slackRolloutConfigured()) return slackIntegrationUnavailable();
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    if (!slackIntegrationEnabledForOrganization(principal.organizationId))
      return slackIntegrationUnavailable();
    assertCan(principal, 'integration:manage');
    const [slackRow] = await db
      .select({ id: schema.integration.id, credentials: schema.integration.credentials })
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, principal.organizationId),
          eq(schema.integration.provider, 'slack'),
          eq(schema.integration.externalId, 'default'),
        ),
      )
      .limit(1);
    const channels =
      slackRow === undefined
        ? []
        : await db
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
            );
    return {
      connected: slackRow !== undefined,
      hasToken: slackRow !== undefined && hasSlackBotToken(slackRow.credentials),
      channels,
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!slackRolloutConfigured()) return slackIntegrationUnavailable();
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    if (!slackIntegrationEnabledForOrganization(principal.organizationId))
      return slackIntegrationUnavailable();
    assertCan(principal, 'integration:manage');
    const input = slackIntegrationActionSchema.parse(await readJson(request));

    if (input.action === 'sync_members') {
      return await syncSlackMembers(principal.organizationId, principal.userId);
    }

    if (input.action === 'connect') {
      if (input.teamId !== null) await assertTeamInWorkspace(principal, input.teamId);
      const channelId = await connectCanonicalSlackChannel(db, {
        organizationId: principal.organizationId,
        userId: principal.userId,
        channelId: input.channelId,
        teamId: input.teamId,
      });
      return { connected: channelId };
    }

    const integrationId = await slackIntegrationId(principal.organizationId);
    const removed = await disconnectSlackChannel(db, { integrationId, channelId: input.channelId });
    return { removed };
  });
}

async function syncSlackMembers(
  organizationId: string,
  userId: string,
): Promise<{ readonly eligible: number; readonly mapped: number }> {
  let result: Awaited<ReturnType<typeof syncSlackUserMappings>>;
  try {
    result = await syncSlackUserMappings(db, { organizationId, userId });
  } catch (error) {
    if (error instanceof SlackApiError && error.code === 'ratelimited') {
      throw rateLimited('Slack is busy. Try syncing members again shortly.');
    }
    if (isSlackReauthorizationError(error)) {
      throw validationFailed('Reconnect Slack before syncing members.');
    }
    throw error;
  }
  if (result.status === 'stale') {
    throw conflict('Slack changed while members were syncing. Try again.');
  }
  return { eligible: result.eligibleMembers, mapped: result.mappedMembers };
}

async function slackIntegrationId(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.integration.id })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, 'slack'),
        eq(schema.integration.externalId, 'default'),
      ),
    )
    .limit(1);
  if (row === undefined) throw validationFailed('Connect Slack before mapping a channel.');
  return row.id;
}

export async function PATCH(): Promise<Response> {
  if (!slackRolloutConfigured()) return slackIntegrationUnavailable();
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    if (!slackIntegrationEnabledForOrganization(principal.organizationId))
      return slackIntegrationUnavailable();
    assertCan(principal, 'integration:manage');
    const conversations = await listSlackConversations(db, {
      organizationId: principal.organizationId,
    });
    if (conversations.channels.length === 0) {
      const [slackRow] = await db
        .select({ credentials: schema.integration.credentials })
        .from(schema.integration)
        .where(
          and(
            eq(schema.integration.organizationId, principal.organizationId),
            eq(schema.integration.provider, 'slack'),
            eq(schema.integration.externalId, 'default'),
          ),
        )
        .limit(1);
      if (slackRow === undefined || !hasSlackBotToken(slackRow.credentials)) {
        throw validationFailed('Connect Slack before listing channels.');
      }
    }
    return { channels: conversations.channels.filter((channel) => channel.isMember) };
  });
}
