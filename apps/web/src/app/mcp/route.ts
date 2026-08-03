import { handleMcpRequest } from '@orbit/mcp-server';
import { publicAppUrl } from '@/lib/env.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function handle(request: Request): Promise<Response> {
  return handleMcpRequest(request, { publicUrl: publicAppUrl() });
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
