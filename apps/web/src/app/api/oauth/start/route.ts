import { absoluteUrl } from '@/lib/env.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const incoming = new URL(request.url);
  const target = new URL(absoluteUrl('/api/auth/mcp/authorize'));
  for (const [key, value] of incoming.searchParams) {
    if (key !== 'prompt') target.searchParams.set(key, value);
  }
  target.searchParams.set('prompt', 'consent');
  return Response.redirect(target.toString(), 302);
}
