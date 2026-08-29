export const DOC_VISIBILITIES = [
  'private',
  'team',
  'workspace',
  'members',
  'link',
  'public',
] as const;
export type DocVisibility = (typeof DOC_VISIBILITIES)[number];

export const DOC_KINDS = ['markdown', 'html'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export function isHtmlDoc(kind: string | null | undefined): boolean {
  return kind === 'html';
}

export const DOC_ACCESS_SUBJECTS = ['user', 'team'] as const;
export type DocAccessSubject = (typeof DOC_ACCESS_SUBJECTS)[number];

export const DOC_ACCESS_LEVELS = ['read', 'write'] as const;
export type DocAccessLevel = (typeof DOC_ACCESS_LEVELS)[number];

export function isExternallyShared(visibility: string): boolean {
  return visibility === 'link' || visibility === 'public';
}

export function isPublished(visibility: string): boolean {
  return visibility === 'members' || isExternallyShared(visibility);
}

export function isRestricted(visibility: string): boolean {
  return visibility === 'private' || visibility === 'team';
}
