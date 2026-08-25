export const HTML_IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-forms',
  'allow-modals',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
  'allow-presentation',
].join(' ');

export const HTML_ARTIFACT_CSP = `sandbox ${HTML_IFRAME_SANDBOX}`;

const HTML_ARTIFACT_SECURITY_HEADERS = {
  'content-security-policy': HTML_ARTIFACT_CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
} as const;

export const MAX_HTML_PREVIEW_BYTES = 2 * 1024 * 1024;

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'] as const;

function baseMime(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isHtmlAttachment(contentType: string): boolean {
  return HTML_CONTENT_TYPES.some((allowed) => allowed === baseMime(contentType));
}

export function htmlArtifactHeaders(): HeadersInit {
  return { 'content-type': 'text/html; charset=utf-8', ...HTML_ARTIFACT_SECURITY_HEADERS };
}

export function htmlAttachmentHeaders(contentType: string): HeadersInit {
  const mime = isHtmlAttachment(contentType) ? baseMime(contentType) : 'text/html';
  return { 'content-type': mime, ...HTML_ARTIFACT_SECURITY_HEADERS };
}
