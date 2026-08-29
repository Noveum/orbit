import { isHtmlDoc } from '@orbit/shared/constants';

export interface PublishedDocRef {
  readonly slug: string;
  readonly publishToken: string | null;
  readonly kind?: string | null | undefined;
}

export function publicDocPath(doc: PublishedDocRef): string | null {
  if (doc.publishToken === null || doc.publishToken.length === 0) return null;
  const slug = doc.slug.trim();
  const suffix = encodeURIComponent(doc.publishToken);
  const root = isHtmlDoc(doc.kind) ? '/h' : '/d';
  return slug.length === 0 ? `${root}/${suffix}` : `${root}/${encodeURIComponent(slug)}-${suffix}`;
}

export function publicDocUrl(doc: PublishedDocRef, origin: string | URL): string | null {
  const path = publicDocPath(doc);
  return path === null ? null : new URL(path, origin).toString();
}

export function appDocPath(docId: string): string {
  return `/docs/${encodeURIComponent(docId)}`;
}

export function newDocPath(
  input: {
    readonly collectionId?: string | null | undefined;
    readonly projectId?: string | null | undefined;
    readonly templateId?: string | null | undefined;
    readonly kind?: string | null | undefined;
  } = {},
): string {
  const params = new URLSearchParams();
  if (input.collectionId != null && input.collectionId.length > 0) {
    params.set('collection', input.collectionId);
  }
  if (input.projectId != null && input.projectId.length > 0) {
    params.set('project', input.projectId);
  }
  if (input.templateId != null && input.templateId.length > 0) {
    params.set('template', input.templateId);
  }
  if (input.kind != null && input.kind.length > 0) {
    params.set('kind', input.kind);
  }
  const query = params.toString();
  return query.length === 0 ? '/docs/new' : `/docs/new?${query}`;
}

export function appDocUrl(docId: string, origin: string | URL): string {
  return new URL(appDocPath(docId), origin).toString();
}
