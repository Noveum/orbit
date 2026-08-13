import { renderMarkdown } from '@orbit/services/markdown';
import { toEditorHtml } from './extensions.ts';

const FORMATTED_MARKDOWN_TAG =
  /<(?:a|blockquote|br|code|del|details|em|h[1-6]|hr|img|mark|ol|pre|strong|table|u|ul)\b/i;

export function editorHtmlFrom(markdown: string): string {
  return toEditorHtml(renderMarkdown(markdown));
}

export function markdownPasteHtml(markdown: string): string | null {
  const html = editorHtmlFrom(markdown);
  return FORMATTED_MARKDOWN_TAG.test(html) ? html : null;
}
