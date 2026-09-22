import { createHash, timingSafeEqual } from 'node:crypto';
import { nudgeStaleProjects } from '@orbit/core';
import { db } from '@orbit/db';
import { cronAuthorizationSchema } from '@orbit/shared/validators';

function presented(request: Request): string | null {
  const parsed = cronAuthorizationSchema.safeParse(request.headers.get('authorization'));
  return parsed.success ? parsed.data.slice('Bearer '.length) : null;
}

function matches(offered: string, expected: string): boolean {
  const left = createHash('sha256').update(offered, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'] ?? '';
  if (secret.length === 0) {
    return Response.json({ error: 'project staleness cron is not configured' }, { status: 503 });
  }
  const token = presented(request);
  if (token === null || !matches(token, secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await nudgeStaleProjects(db, new Date());
  return Response.json({ nudged: result.nudged, suppressed: result.suppressed });
}
