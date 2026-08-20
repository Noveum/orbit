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

export function htmlArtifactHeaders(): HeadersInit {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': HTML_ARTIFACT_CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'private, no-store',
  };
}
