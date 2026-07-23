import { decodeEntities, htmlToText } from '@orbit/services/markdown';
import { slugify as baseSlugify } from '@orbit/shared/utils';

export interface DocHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

export interface OutlinedHtml {
  readonly html: string;
  readonly headings: DocHeading[];
}

const HEADING_TAG = /<h([1-3])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi;
const EXISTING_ID = /\sid="[^"]*"/gi;

export function slugify(text: string): string {
  const base = baseSlugify(text);
  return base.length === 0 ? 'section' : base;
}

export function uniqueHeadingId(text: string, used: Map<string, number>): string {
  const base = slugify(text);
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

export function withHeadingIds(html: string): OutlinedHtml {
  const used = new Map<string, number>();
  const headings: DocHeading[] = [];

  const rewritten = html.replace(
    HEADING_TAG,
    (match, level: string, attrs: string, inner: string) => {
      const text = decodeEntities(htmlToText(inner)).replace(/\s+/g, ' ').trim();
      if (text.length === 0) return match;

      const id = uniqueHeadingId(text, used);
      headings.push({ id, text, level: Number.parseInt(level, 10) });
      return `<h${level}${attrs.replace(EXISTING_ID, '')} id="${id}">${inner}</h${level}>`;
    },
  );

  return { html: rewritten, headings };
}

export function sameHeadings(left: readonly DocHeading[], right: readonly DocHeading[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((heading, index) => heading.id === right[index]?.id);
}

export function readTimeMinutes(markdown: string): number {
  const words = markdown
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return Math.max(1, Math.round(words / 220));
}
