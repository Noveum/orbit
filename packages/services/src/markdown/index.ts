import { slugify, truncate } from '@orbit/shared/utils';
import { Marked, type Tokens } from 'marked';
import { escapeHtml, highlightCode, languageAlias } from './highlight.ts';
import { decodeEntities, htmlToText, sanitizeHtml } from './sanitize.ts';

export { extractIssueIdentifiers, extractMentions } from '@orbit/shared/utils';
export { highlightCode, languageAlias } from './highlight.ts';
export { decodeEntities, htmlToText, sanitizeHtml } from './sanitize.ts';

export const MERMAID_LANGUAGE = 'mermaid';

const UNSAFE_URL = /^\s*(javascript|vbscript|file|data):/i;
const BLOCK_END = /<\/(p|h[1-6]|li|blockquote|pre|tr|table|ul|ol)>/gi;
const IMAGE_KEYS = ['tokens', 'items', 'rows', 'header', 'cells'] as const;
const HEADING_TAG = /<h([1-3])((?:[^>"]|"[^"]*")*)>([\s\S]*?)<\/h\1>/gi;
const EXISTING_ID = /\sid="[^"]*"/gi;

function alignment(align: 'center' | 'left' | 'right' | null): string {
  return align === null ? '' : ` align="${align}"`;
}

function isTaskList(token: Tokens.List): boolean {
  return token.items.length > 0 && token.items.every((item) => item.task);
}

function listStart(token: Tokens.List): string {
  return token.ordered && token.start !== 1 ? ` start="${token.start}"` : '';
}

const marked = new Marked({ gfm: true, breaks: false, pedantic: false, async: false }).use({
  renderer: {
    code({ text, lang }): string {
      const alias = languageAlias(lang ?? '');
      if (alias === MERMAID_LANGUAGE) {
        return `<div data-mermaid><pre><code class="language-${MERMAID_LANGUAGE}">${escapeHtml(text)}\n</code></pre></div>\n`;
      }
      const classes = alias.length === 0 ? 'hljs' : `hljs language-${escapeHtml(alias)}`;
      const language = alias.length === 0 ? '' : ` data-code-language="${escapeHtml(alias)}"`;
      return `<div data-code-block${language}><pre><code class="${classes}">${highlightCode(text, alias)}\n</code></pre></div>\n`;
    },
    list(token): string {
      const tag = token.ordered ? 'ol' : 'ul';
      const laysOutTasks = !token.ordered;
      const listAttrs = laysOutTasks && isTaskList(token) ? ' data-type="taskList"' : '';
      const items = token.items
        .map((item) => {
          const checked =
            laysOutTasks && item.task ? ` data-checked="${item.checked === true}"` : '';
          return `<li${checked}>${this.parser.parse(item.tokens)}</li>\n`;
        })
        .join('');
      return `<${tag}${listStart(token)}${listAttrs}>\n${items}</${tag}>\n`;
    },
    table(token): string {
      const header = token.header
        .map((cell) => `<th${alignment(cell.align)}>${this.parser.parseInline(cell.tokens)}</th>`)
        .join('');
      const body = token.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td${alignment(cell.align)}>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`,
        )
        .join('');
      return `<div data-table-scroll><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>\n`;
    },
  },
});

export function renderMarkdown(source: string): string {
  if (source.trim().length === 0) return '';
  return sanitizeHtml(marked.parse(source, { async: false }));
}

function headingSlug(text: string): string {
  const base = slugify(text);
  return base.length === 0 ? 'section' : base;
}

function uniqueHeadingId(text: string, used: Map<string, number>): string {
  const base = headingSlug(text);
  let suffix = used.get(base) ?? 0;
  let id = suffix === 0 ? base : `${base}-${suffix}`;
  while (used.has(id)) {
    suffix += 1;
    id = `${base}-${suffix}`;
  }
  used.set(base, suffix + 1);
  if (id !== base) used.set(id, 0);
  return id;
}

export function renderMarkdownWithHeadingIds(source: string): string {
  const used = new Map<string, number>();
  const withIds = renderMarkdown(source).replace(
    HEADING_TAG,
    (match: string, level: string, attrs: string, inner: string) => {
      const text = decodeEntities(htmlToText(inner)).replace(/\s+/g, ' ').trim();
      if (text.length === 0) return match;
      const id = uniqueHeadingId(text, used);
      return `<h${level}${attrs.replace(EXISTING_ID, '')} id="${id}">${inner}</h${level}>`;
    },
  );
  return sanitizeHtml(withIds);
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
