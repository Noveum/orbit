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

function safeCharsetValue(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  const quoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  const value = quoted ? trimmed.slice(1, -1) : trimmed;
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

function mimeParts(contentType: string): readonly string[] | null {
  const parts: string[] = [];
  let part = '';
  let quoted = false;
  let escaped = false;
  for (const character of contentType) {
    if (escaped) {
      part += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      part += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      part += character;
      quoted = !quoted;
      continue;
    }
    if (character === ';' && !quoted) {
      parts.push(part);
      part = '';
      continue;
    }
    part += character;
  }
  if (quoted || escaped) return null;
  parts.push(part);
  return parts;
}

function safeCharset(contentType: string): string | null {
  const parts = mimeParts(contentType);
  if (parts === null) return null;
  let charset: string | null = null;
  for (const parameter of parts.slice(1)) {
    const separator = parameter.indexOf('=');
    const name = (separator < 0 ? parameter : parameter.slice(0, separator)).trim().toLowerCase();
    if (name !== 'charset') continue;
    if (separator < 0 || charset !== null) return null;
    const value = safeCharsetValue(parameter.slice(separator + 1));
    if (value === null) return null;
    charset = value;
  }
  return charset;
}

export function isHtmlAttachment(contentType: string): boolean {
  return HTML_CONTENT_TYPES.some((allowed) => allowed === baseMime(contentType));
}

export function htmlArtifactHeaders(): HeadersInit {
  return { 'content-type': 'text/html; charset=utf-8', ...HTML_ARTIFACT_SECURITY_HEADERS };
}

export function htmlAttachmentHeaders(contentType: string): HeadersInit {
  const mime = isHtmlAttachment(contentType) ? baseMime(contentType) : 'text/html';
  const charset = safeCharset(contentType);
  const safeContentType = charset === null ? mime : `${mime}; charset=${charset}`;
  return { 'content-type': safeContentType, ...HTML_ARTIFACT_SECURITY_HEADERS };
}
