const ISSUE_PATH = /^\/issue\/([a-z][a-z0-9]{1,5}-\d+)(?:[/?#]|$)/i;
const DOC_PATH = /^\/docs\/([^/?#]{1,64})(?:[/?#]|$)/;

export function issueIdentifierFromUrl(url: string): string | null {
  const identifier = ISSUE_PATH.exec(url)?.[1];
  return identifier === undefined ? null : identifier.toUpperCase();
}

export function docIdFromUrl(url: string): string | null {
  const docId = DOC_PATH.exec(url)?.[1];
  if (docId === undefined || docId === 'new') return null;
  try {
    return decodeURIComponent(docId);
  } catch {
    return docId;
  }
}
