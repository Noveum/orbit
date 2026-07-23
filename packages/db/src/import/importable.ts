import { IMAGE_TAG_SOURCE } from './assets.ts';
import { htmlToMarkdown } from './markdown.ts';

const HAS_IMAGE = new RegExp(IMAGE_TAG_SOURCE);

export function isImportableComment(html: string | null | undefined): boolean {
  if (typeof html !== 'string' || html.length === 0) return false;
  if (HAS_IMAGE.test(html)) return true;
  return htmlToMarkdown(html).length > 0;
}
