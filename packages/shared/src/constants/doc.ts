export const DOC_VISIBILITIES = ['workspace', 'link', 'public'] as const;
export type DocVisibility = (typeof DOC_VISIBILITIES)[number];
