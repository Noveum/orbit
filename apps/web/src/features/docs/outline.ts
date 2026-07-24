import { decodeEntities, htmlToText } from '@orbit/services/markdown';

export interface DocHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

const HEADING_WITH_ID = /<h([1-3])[^>]*?\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/gi;

export function extractHeadings(html: string): DocHeading[] {
  const headings: DocHeading[] = [];
  for (const match of html.matchAll(HEADING_WITH_ID)) {
    const [, level, id, inner] = match;
    if (level === undefined || id === undefined || inner === undefined) continue;
    const text = decodeEntities(htmlToText(inner)).replace(/\s+/g, ' ').trim();
    headings.push({ id, text, level: Number.parseInt(level, 10) });
  }
  return headings;
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
