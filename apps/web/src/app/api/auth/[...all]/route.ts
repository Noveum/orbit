import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth/server.ts';
import { withSocketRevocation } from '@/lib/auth/sign-out.ts';

const handlers = toNextJsHandler(auth.handler);

const MCP_AUTHORIZE_PATH = '/api/auth/mcp/authorize';

export function GET(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  if (url.pathname === MCP_AUTHORIZE_PATH) {
    const prompts = url.searchParams.getAll('prompt');
    if (prompts.length !== 1 || prompts[0] !== 'consent') {
      return Response.json(
        { error: 'invalid_request', error_description: 'Explicit consent is required.' },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }
  }
  return handlers.GET(request);
}

export function POST(request: Request): Promise<Response> {
  return withSocketRevocation(request, handlers.POST);
}
