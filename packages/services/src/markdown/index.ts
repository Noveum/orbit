import { truncate } from '@orbit/shared/utils';
import type { Config } from 'isomorphic-dompurify';
import DOMPurify from 'isomorphic-dompurify';
import { Marked } from 'marked';

export { extractIssueIdentifiers, extractMentions } from '@orbit/shared/utils';

const SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'em',
    'strong',
    'del',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'input',
    'span',
    'sup',
    'sub',
  ],
  ALLOWED_ATTR: [
    'href',
    'src',
    'alt',
    'title',
    'class',
    'align',
    'type',
    'checked',
    'disabled',
    'colspan',
    'rowspan',
    'start',
    'width',
    'height',
    'target',
    'rel',
  ],
  FORBID_TAGS: [
    'script',
    'iframe',
    'style',
    'object',
    'embed',
    'form',
    'link',
    'meta',
    'base',
    'svg',
    'math',
    'template',
  ],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'xlink:href'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

const ABSOLUTE_URL = /^https?:\/\//i;
const UNSAFE_URL = /^\s*(javascript|vbscript|file|data):/i;
const BLOCK_END = /<\/(p|h[1-6]|li|blockquote|pre|tr|table|ul|ol)>/gi;
const IMAGE_KEYS = ['tokens', 'items', 'rows', 'header', 'cells'] as const;

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName !== 'A' || typeof node.getAttribute !== 'function') return;
  const href = node.getAttribute('href') ?? '';
  if (ABSOLUTE_URL.test(href)) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
    return;
  }
  node.removeAttribute('target');
  node.removeAttribute('rel');
});

const marked = new Marked({ gfm: true, breaks: false, pedantic: false, async: false });

export function renderMarkdown(source: string): string {
  if (source.trim().length === 0) return '';
  return DOMPurify.sanitize(marked.parse(source, { async: false }), SANITIZE_CONFIG);
}

export function renderPlainText(source: string): string {
  const html = renderMarkdown(source).replace(BLOCK_END, (tag) => `${tag}\n`);
  const body = DOMPurify.sanitize(html, { ...SANITIZE_CONFIG, RETURN_DOM: true });
  return (body.textContent ?? '')
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
