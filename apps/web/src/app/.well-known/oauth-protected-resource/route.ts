import { oAuthProtectedResourceMetadata } from 'better-auth/plugins';
import { auth } from '@/lib/auth/server.ts';
import { metadataPreflight } from '../metadata-headers.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = oAuthProtectedResourceMetadata(auth);

export function OPTIONS(): Response {
  return metadataPreflight();
}
