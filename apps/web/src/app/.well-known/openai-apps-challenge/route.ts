import { publicAppUrl } from '@/lib/env.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const hostedOrigin = 'https://orbit.noveum.ai';
  if (publicAppUrl() !== hostedOrigin || new URL(request.url).origin !== hostedOrigin) {
    return new Response(null, { status: 404 });
  }
  return new Response('VhrTlXHaceRqWsHvFEhpumU_WumX17m02n52-sG4MyA', {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
