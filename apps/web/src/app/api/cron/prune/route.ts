import { timingSafeEqual } from 'node:crypto';
import { db, pruneOperationalTables } from '@orbit/db';

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
    return Response.json({ error: 'pruning is not configured' }, { status: 503 });
  }
  if (!matches(presented(request), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pruned = await pruneOperationalTables(db);
  return Response.json({ pruned });
}
