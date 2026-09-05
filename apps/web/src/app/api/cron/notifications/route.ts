import { timingSafeEqual } from 'node:crypto';
import { deliverPendingSlackDms } from '@orbit/core';
import { db } from '@orbit/db';
import { reconcilePendingGithubWork } from '@orbit/services';
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
  const [githubResult, delivered] = await Promise.all([
    githubConfigured
      ? reconcilePendingGithubWork(db, {
          appId: github.appId,
          privateKey: github.privateKey,
          limit: 20,
        })
      : Promise.resolve(EMPTY_GITHUB_RESULT),
    slackIntegrationEnabled() ? deliverPendingSlackDms(db, 100) : Promise.resolve(0),
  ]);
  const { actions: githubActions, ...githubCounts } = githubResult;
  await publish(githubActions);
  return Response.json({
    delivered,
    github: { configured: githubConfigured, ...githubCounts },
  });
}
