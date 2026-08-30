import { and, db, eq, schema } from '@orbit/db';
import {
  connectSlackChannel,
  disconnectSlackChannel,
  listSlackConversations,
} from '@orbit/services';
import { hasSlackBotToken } from '@orbit/services/slack/credentials';
import { validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import { slackConnectChannelSchema, slackDisconnectChannelSchema } from '@orbit/shared/validators';
import { z } from 'zod';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';
import {
  slackIntegrationEnabledForOrganization,
  slackIntegrationUnavailable,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';
import { assertTeamInWorkspace } from '@/lib/workspace.ts';

const requestSchema = z.discriminatedUnion('action', [
  slackConnectChannelSchema.extend({ action: z.literal('connect') }),
  slackDisconnectChannelSchema.extend({ action: z.literal('disconnect') }),
]);

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
    const input = requestSchema.parse(await readJson(request));

    const integrationId = await slackIntegrationId(principal.organizationId);
    if (input.action === 'connect') {
      if (input.teamId !== null) await assertTeamInWorkspace(principal, input.teamId);
      await connectSlackChannel(db, {
        organizationId: principal.organizationId,
        integrationId,
        channelId: input.channelId,
        channelName: input.channelName,
        teamId: input.teamId,
      });
      return { connected: input.channelId };
    }

    const removed = await disconnectSlackChannel(db, { integrationId, channelId: input.channelId });
    return { removed };
  });
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
