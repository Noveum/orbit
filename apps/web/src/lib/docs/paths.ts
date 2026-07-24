export interface PublishedDocRef {
  readonly slug: string;
  readonly publishToken: string | null;
}

export function publicDocPath(doc: PublishedDocRef): string | null {
  if (doc.publishToken === null || doc.publishToken.length === 0) return null;
  const slug = doc.slug.trim();
  const suffix = encodeURIComponent(doc.publishToken);
  return slug.length === 0 ? `/d/${suffix}` : `/d/${encodeURIComponent(slug)}-${suffix}`;
}

export function publicDocUrl(doc: PublishedDocRef, origin: string | URL): string | null {
  const path = publicDocPath(doc);
  return path === null ? null : new URL(path, origin).toString();
}
