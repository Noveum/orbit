import { db } from '@orbit/db';
import { resolveSlackContext, SlackClient } from '@orbit/services';
import { assertCan } from '@orbit/shared/policy';
import { z } from 'zod';
import { apiContext, handleRoute, searchParamsOf } from '@/lib/api/handler.ts';
import {
  slackIntegrationEnabledForOrganization,
  slackIntegrationUnavailable,
  slackRolloutConfigured,
} from '@/lib/integrations/slack-capability.ts';

const querySchema = z.object({ cursor: z.string().min(1).max(1024).optional() });

export async function GET(request: Request): Promise<Response> {
  if (!slackRolloutConfigured()) return slackIntegrationUnavailable();
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    if (!slackIntegrationEnabledForOrganization(principal.organizationId))
      return slackIntegrationUnavailable();
    assertCan(principal, 'integration:manage');
    const { cursor } = querySchema.parse(searchParamsOf(request));

    const context = await resolveSlackContext(db, principal.organizationId, 'default');
    if (context === null || context.token === null) {
      return { channels: [], nextCursor: null };
    }

    const conversations = await new SlackClient({ token: context.token }).listConversations(
      cursor === undefined ? {} : { cursor },
    );
    return {
      channels: conversations.channels
        .filter((channel) => channel.isMember)
        .map((channel) => ({
          channelId: channel.id,
          channelName: channel.name,
        })),
      nextCursor: conversations.nextCursor,
    };
  });
}
