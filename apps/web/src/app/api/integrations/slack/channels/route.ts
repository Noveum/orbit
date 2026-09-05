import { db } from '@orbit/db';
import { listSlackConversations } from '@orbit/services';
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

    const conversations = await listSlackConversations(db, {
      organizationId: principal.organizationId,
      ...(cursor === undefined ? {} : { cursor }),
    });
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
