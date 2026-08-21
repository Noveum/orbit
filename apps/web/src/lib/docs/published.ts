import { type DocDetail, type PublishedDocResolution, resolvePublishedDoc } from '@orbit/core';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session.ts';

export function signInNextPath(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

export async function lookupPublishedDoc(pathSegment: string): Promise<PublishedDocResolution> {
  const session = await getSession();
  return await resolvePublishedDoc(pathSegment, session?.user.id ?? null);
}

export async function loadPublishedDoc(
  pathSegment: string,
  requestPath: string,
): Promise<DocDetail> {
  const result = await lookupPublishedDoc(pathSegment);
  if (result.status === 'sign-in') redirect(signInNextPath(requestPath));
  if (result.status === 'missing') notFound();
  return result.detail;
}
