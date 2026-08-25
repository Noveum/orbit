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

export function htmlArtifactHeaders(): HeadersInit {
  return { 'content-type': 'text/html; charset=utf-8', ...HTML_ARTIFACT_SECURITY_HEADERS };
}

export const MAX_HTML_PREVIEW_BYTES = 2 * 1024 * 1024;

export function htmlUploadHeaders(): HeadersInit {
  return { 'content-type': 'text/html', ...HTML_ARTIFACT_SECURITY_HEADERS };
}

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];

export function isHtmlAttachment(contentType: string): boolean {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return HTML_CONTENT_TYPES.includes(mime);
}
