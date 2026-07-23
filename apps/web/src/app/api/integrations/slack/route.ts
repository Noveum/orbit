import { and, db, eq, schema } from '@orbit/db';
import {
  connectSlackChannel,
  disconnectSlackChannel,
  ensureSlackIntegration,
  resolveSlackContext,
  SlackClient,
} from '@orbit/services';
import { validationFailed } from '@orbit/shared/errors';
import { assertCan } from '@orbit/shared/policy';
import {
  slackConnectChannelSchema,
  slackDisconnectChannelSchema,
  slackInstallSchema,
} from '@orbit/shared/validators';
import { z } from 'zod';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';

const requestSchema = z.discriminatedUnion('action', [
  slackInstallSchema.extend({ action: z.literal('install') }),
  slackConnectChannelSchema.extend({ action: z.literal('connect') }),
  slackDisconnectChannelSchema.extend({ action: z.literal('disconnect') }),
]);

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const channels = await db
      .select({
        channelId: schema.slackChannelSync.channelId,
        channelName: schema.slackChannelSync.channelName,
        teamId: schema.slackChannelSync.teamId,
        enabled: schema.slackChannelSync.enabled,
      })
      .from(schema.slackChannelSync)
      .where(eq(schema.slackChannelSync.organizationId, principal.organizationId));
    const context = await resolveSlackContext(db, principal.organizationId);
    return { connected: context !== null, hasToken: context?.token != null, channels };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const input = requestSchema.parse(await readJson(request));

    if (input.action === 'install') {
      const integrationId = await ensureSlackIntegration(db, {
        organizationId: principal.organizationId,
        connectedById: principal.userId,
        botToken: input.botToken,
      });
      return { integrationId };
    }

    const integrationId = await slackIntegrationId(principal.organizationId);
    if (input.action === 'connect') {
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
      ),
    )
    .limit(1);
  if (row === undefined) throw validationFailed('Connect Slack before mapping a channel.');
  return row.id;
}

export async function PATCH(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'integration:manage');
    const context = await resolveSlackContext(db, principal.organizationId);
    if (context === null || context.token === null) {
      throw validationFailed('Connect Slack before listing channels.');
    }
    const conversations = await new SlackClient({ token: context.token }).listConversations();
    return { channels: conversations.channels };
  });
}
