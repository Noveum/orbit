import { timingSafeEqual } from 'node:crypto';
import { drainIssueOutbox, issueOutboxStats, publishDeltas } from '@orbit/core';
import { agentFeatureEnabled } from '@orbit/shared';

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const offered = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '', 'utf8');
  const expected = Buffer.from(secret, 'utf8');
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'] ?? '';
  if (
    secret.length === 0 ||
    !process.env['REDIS_URL'] ||
    !agentFeatureEnabled('issue_outbox_dispatch')
  ) {
    return Response.json({ error: 'issue outbox recovery is not configured' }, { status: 503 });
  }
  if (!authorized(request, secret))
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  const drained = await drainIssueOutbox({ publish: publishDeltas });
  return Response.json({ drained, stats: await issueOutboxStats() });
}
