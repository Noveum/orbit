import { renderMarkdown } from '@orbit/services/markdown';
import { toEditorHtml } from './extensions.ts';

export function editorHtmlFrom(markdown: string): string {
  return toEditorHtml(renderMarkdown(markdown));
}
