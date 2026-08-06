import { auth, MCP_AUTHORIZE_START_PATH, MCP_SCOPES } from '@/lib/auth/server.ts';
import { absoluteUrl } from '@/lib/env.ts';
import { METADATA_CORS_HEADERS, metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const metadata = await auth.api.getMcpOAuthConfig();
  const patched = {
    ...metadata,
    authorization_endpoint: absoluteUrl(MCP_AUTHORIZE_START_PATH),
    scopes_supported: [...MCP_SCOPES],
  };
  return Response.json(patched, { headers: METADATA_CORS_HEADERS });
}

export function OPTIONS(): Response {
  return metadataPreflight();
}
