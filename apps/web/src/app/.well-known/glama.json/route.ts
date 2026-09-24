import { publicAppUrl } from '@/lib/env.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const hostedOrigin = 'https://orbit.noveum.ai';
  if (publicAppUrl() !== hostedOrigin || new URL(request.url).origin !== hostedOrigin) {
    return new Response(null, { status: 404 });
  }
  return Response.json(
    {
      $schema: 'https://glama.ai/mcp/schemas/connector.json',
      claim: 'glama_claim_BsJlGdtMT0xXnfmJYj12vj-2wKqLymxv',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
