const UNSAFE_FILENAME = /[^a-z0-9]+/gi;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FIRST_HEADING = /^#\s+(.+)$/m;

export function fileNameFor(title: string, extension: string): string {
  const slug = title.trim().replace(UNSAFE_FILENAME, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${slug.length > 0 ? slug.slice(0, 80) : 'document'}.${extension}`;
}

export function absoluteAttachments(markdown: string, origin: string): string {
  const base = origin.replace(/\/$/, '');
  return markdown.replace(
    /(\]\()(\/api\/files\/[^)\s]+)/g,
    (_match, open: string, path: string) => {
      return `${open}${base}${path}`;
    },
  );
}

export function exportedMarkdown(title: string, content: string, origin: string): string {
  const body = absoluteAttachments(content.trimEnd(), origin);
  const heading = FIRST_HEADING.exec(body);
  if (heading !== null && heading[1]?.trim() === title.trim()) return `${body}\n`;
  return `# ${title}\n\n${body}\n`;
}

function frontMatterTitle(block: string): string | null {
  for (const line of block.split(/\r?\n/)) {
    const match = /^title\s*:\s*(.+)$/i.exec(line.trim());
    if (match === null) continue;
    const value = (match[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
    if (value.length > 0) return value;
  }
  return null;
}

export interface ImportedDoc {
  readonly title: string;
  readonly content: string;
  readonly kind: 'markdown' | 'html';
}

const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_EXTENSION = /\.(html?|xhtml)$/i;
const MARKDOWN_EXTENSION = /\.(mdx?|markdown)$/i;

export function importKindOf(fileName: string, type = ''): 'markdown' | 'html' {
  if (HTML_EXTENSION.test(fileName) || type === 'text/html') return 'html';
  if (MARKDOWN_EXTENSION.test(fileName) || type === 'text/markdown') return 'markdown';
  return 'markdown';
}

function titleFromFile(fileName: string, extension: RegExp, fallback: string): string {
  const fromFile = fileName.replace(extension, '').replace(/[-_]+/g, ' ').trim();
  return fromFile.length > 0 ? fromFile : fallback;
}

export function parseMarkdownImport(fileName: string, text: string): ImportedDoc {
  let body = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

  const matter = FRONT_MATTER.exec(body);
  let fromMatter: string | null = null;
  if (matter !== null) {
    fromMatter = frontMatterTitle(matter[1] ?? '');
    body = body.slice(matter[0].length);
  }

  const heading = FIRST_HEADING.exec(body);
  const fromHeading = heading?.[1]?.trim() ?? null;
  if (fromMatter === null && fromHeading !== null && body.trimStart().startsWith('#')) {
    body = body.replace(FIRST_HEADING, '').trimStart();
  }

  const title =
    fromMatter ?? fromHeading ?? titleFromFile(fileName, MARKDOWN_EXTENSION, 'Imported document');

  return { title: title.slice(0, 200), content: body.trim(), kind: 'markdown' };
}

export function parseHtmlImport(fileName: string, text: string): ImportedDoc {
  const body = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const tagged = TITLE_TAG.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  const fromTag = tagged.length > 0 ? tagged : null;
  const title = fromTag ?? titleFromFile(fileName, HTML_EXTENSION, 'Untitled page');
  return { title: title.slice(0, 200), content: body.trim(), kind: 'html' };
}

export function parseDocImport(fileName: string, text: string, type = ''): ImportedDoc {
  return importKindOf(fileName, type) === 'html'
    ? parseHtmlImport(fileName, text)
    : parseMarkdownImport(fileName, text);
}
