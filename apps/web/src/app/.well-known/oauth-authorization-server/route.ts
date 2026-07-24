import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { auth } from '@/lib/auth/server.ts';
import { metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = oAuthDiscoveryMetadata(auth);

export function OPTIONS(): Response {
  return metadataPreflight();
}
