import { createHash, timingSafeEqual } from 'node:crypto';
import { writeCycleSnapshots } from '@orbit/core';
import { publish } from '@/lib/api/handler.ts';

function presented(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function matches(offered: string, expected: string): boolean {
  const left = createHash('sha256').update(offered, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env['CRON_SECRET'] ?? '';
  if (secret.length === 0) {
    return Response.json({ error: 'analytics snapshots are not configured' }, { status: 503 });
  }
  if (!matches(presented(request), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await writeCycleSnapshots({ now: new Date() });
  await publish(result.actions);
  return Response.json({ captured: result.captured });
}
