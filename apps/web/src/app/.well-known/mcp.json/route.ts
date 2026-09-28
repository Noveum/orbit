import { mcpServerUrl } from '@/lib/env.ts';
import { METADATA_CORS_HEADERS, metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    {
      name: 'Orbit',
      description: 'Task management for people and agents, with workspace-scoped OAuth.',
      transport: 'streamable-http',
      url: mcpServerUrl(),
      authentication: { type: 'oauth2', required: true },
    },
    { headers: METADATA_CORS_HEADERS },
  );
}

export function OPTIONS(): Response {
  return metadataPreflight();
}
