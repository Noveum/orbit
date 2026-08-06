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

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;

function addParagraphAbove(lines: readonly string[], underline: number, chosen: Set<number>): void {
  for (let above = underline - 1; above >= 0; above -= 1) {
    if (chosen.has(above)) return;
    if ((lines[above] ?? '').trim().length === 0) return;
    chosen.add(above);
  }
}

export function headingSignature(markdown: string): string {
  const lines = markdown.split('\n');
  const chosen = new Set<number>();

  for (const [index, line] of lines.entries()) {
    if (ATX_HEADING.test(line) || FENCE.test(line)) {
      chosen.add(index);
      continue;
    }
    if (!SETEXT_UNDERLINE.test(line)) continue;
    chosen.add(index);
    addParagraphAbove(lines, index, chosen);
  }

  return [...chosen]
    .sort((left, right) => left - right)
    .map((index) => lines[index] ?? '')
    .join('\n');
}

export interface OutlineMemo {
  readonly signature: string | null;
  readonly headings: readonly DocHeading[];
}

export const EMPTY_OUTLINE: OutlineMemo = { signature: null, headings: [] };

export function outlineFor(
  memo: OutlineMemo,
  markdown: string,
  build: (source: string) => readonly DocHeading[],
): OutlineMemo {
  const signature = headingSignature(markdown);
  if (signature === memo.signature) return memo;
  return { signature, headings: build(markdown) };
}
