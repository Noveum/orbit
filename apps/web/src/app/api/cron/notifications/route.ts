import { timingSafeEqual } from 'node:crypto';
import {
  deliverPendingNotificationEmails,
  deliverPendingSlackChannels,
  deliverPendingSlackDms,
} from '@orbit/core';
import { db } from '@orbit/db';
import {
  notificationConversationActions,
  reconcilePendingGithubWork,
  wakeDueNotificationConversations,
} from '@orbit/services';
import { publish } from '@/lib/api/handler.ts';
import { githubAppConfig } from '@/lib/env.ts';
import { slackIntegrationEnabled } from '@/lib/integrations/slack-capability.ts';

export const maxDuration = 300;

const EMPTY_GITHUB_RESULT = {
  processed: 0,
  checkHeads: 0,
  pullRequests: 0,
  accepted: 0,
  retryScheduled: 0,
  failed: 0,
  actions: [],
};

function presented(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function matches(offered: string, expected: string): boolean {
  const left = Buffer.from(offered, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'] ?? '';
  if (secret.length === 0) {
    return Response.json({ error: 'notifications cron is not configured' }, { status: 503 });
  }
  if (!matches(presented(request), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const github = githubAppConfig();
  const githubConfigured = github.appId.length > 0 && github.privateKey.length > 0;
  const providersEnabled = process.env['NOTIFICATION_PROVIDERS_PAUSED'] !== 'true';
  const [githubResult, slackDms, slackChannels, emails, snoozes] = await Promise.all([
    githubConfigured
      ? reconcilePendingGithubWork(db, {
          appId: github.appId,
          privateKey: github.privateKey,
          limit: 20,
        })
      : Promise.resolve(EMPTY_GITHUB_RESULT),
    providersEnabled && slackIntegrationEnabled()
      ? deliverPendingSlackDms(db, 100)
      : Promise.resolve(0),
    providersEnabled && slackIntegrationEnabled()
      ? deliverPendingSlackChannels(db, 100)
      : Promise.resolve(0),
    providersEnabled && process.env['RESEND_API_KEY'] && process.env['EMAIL_FROM']
      ? deliverPendingNotificationEmails(db, 100)
      : Promise.resolve(0),
    wakeDueNotificationConversations(db, { limit: 100 }),
  ]);
  const { actions: githubActions, ...githubCounts } = githubResult;
  const wakeActions = await notificationConversationActions(db, snoozes.changes, {
    type: 'system',
    id: 'orbit',
    name: 'Orbit',
  });
  await publish([...githubActions, ...wakeActions]);
  return Response.json({
    delivered: slackDms + slackChannels + emails,
    providers: { slackDms, slackChannels, emails },
    snoozes: { woken: snoozes.woken, stale: snoozes.stale },
    github: { configured: githubConfigured, ...githubCounts },
  });
}
