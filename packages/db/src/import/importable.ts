import { htmlToMarkdown } from './markdown.ts';

export function isImportableComment(html: string | null | undefined): boolean {
  if (typeof html !== 'string' || html.length === 0) return false;
  if (/<image-component[^>]*\bsrc="[0-9a-fA-F-]{36}"/.test(html)) return true;
  return htmlToMarkdown(html).length > 0;
}
