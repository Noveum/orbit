import { auth, MCP_RESOURCE_SCOPES } from '@/lib/auth/server.ts';
import { METADATA_CORS_HEADERS, metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const advertised = (request: Request) => auth.handler(request);

export function withOrbitScopes(metadata: Record<string, unknown>): Record<string, unknown> {
  return { ...metadata, scopes_supported: [...MCP_RESOURCE_SCOPES] };
}

export async function GET(request: Request): Promise<Response> {
  const response = await advertised(request);
  const metadata: unknown = await response.json().catch(() => null);
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return response;

  return Response.json(withOrbitScopes(metadata as Record<string, unknown>), {
    status: response.status,
    headers: { ...METADATA_CORS_HEADERS },
  });
}

export function OPTIONS(): Response {
  return metadataPreflight();
}
