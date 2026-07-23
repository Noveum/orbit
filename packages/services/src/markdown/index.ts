import { truncate } from '@orbit/shared/utils';
import { Marked } from 'marked';
import { decodeEntities, htmlToText, sanitizeHtml } from './sanitize.ts';

export { extractIssueIdentifiers, extractMentions } from '@orbit/shared/utils';

const UNSAFE_URL = /^\s*(javascript|vbscript|file|data):/i;
const BLOCK_END = /<\/(p|h[1-6]|li|blockquote|pre|tr|table|ul|ol)>/gi;
const IMAGE_KEYS = ['tokens', 'items', 'rows', 'header', 'cells'] as const;

const marked = new Marked({ gfm: true, breaks: false, pedantic: false, async: false });

export function renderMarkdown(source: string): string {
  if (source.trim().length === 0) return '';
  return sanitizeHtml(marked.parse(source, { async: false }));
}

export function renderPlainText(source: string): string {
  const html = renderMarkdown(source).replace(BLOCK_END, (tag) => `${tag}\n`);
  return decodeEntities(htmlToText(html))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function summarize(source: string, maxChars: number): string {
  const text = renderPlainText(source).replace(/\s+/g, ' ').trim();
  return truncate(text, maxChars);
}

export function extractFirstImage(source: string): string | null {
  return findImage(marked.lexer(source));
}

function findImage(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImage(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const node = value as Record<string, unknown>;
  const href = node['href'];
  if (node['type'] === 'image' && typeof href === 'string' && !UNSAFE_URL.test(href)) return href;
  for (const key of IMAGE_KEYS) {
    const found = findImage(node[key]);
    if (found !== null) return found;
  }
  return null;
}
