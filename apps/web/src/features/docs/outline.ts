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

const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const FENCE = /^(?:`{3,}|~{3,})/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const DASH_UNDERLINE = /^-+[ \t]*$/;
const RAW_HTML = /<[a-zA-Z/!?]/;
const LEADING_SPACE = /^[ \t]+/;
const BLOCK_MARKER = /^(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t]))/;

function blockContent(line: string): string {
  let rest = line.replace(LEADING_SPACE, '');
  let stripped = rest.replace(BLOCK_MARKER, '').replace(LEADING_SPACE, '');
  while (stripped !== rest) {
    rest = stripped;
    stripped = rest.replace(BLOCK_MARKER, '').replace(LEADING_SPACE, '');
  }
  return rest;
}

function blockPrefixWidth(line: string): number {
  return line.length - blockContent(line).length;
}

function blank(lines: readonly string[], index: number): boolean {
  return (lines[index] ?? '').trim().length === 0;
}

function plainParagraph(line: string): boolean {
  const content = blockContent(line);
  if (content.length === 0 || RAW_HTML.test(content)) return false;
  return !(ATX_HEADING.test(content) || FENCE.test(content) || SETEXT_UNDERLINE.test(content));
}

function underlinesAParagraph(lines: readonly string[], index: number): boolean {
  if (index === 0) return false;
  const line = lines[index] ?? '';
  const content = blockContent(line);
  if (!SETEXT_UNDERLINE.test(content)) return false;
  const above = lines[index - 1] ?? '';
  if (!plainParagraph(above)) return false;
  if (!DASH_UNDERLINE.test(content)) return true;
  return blockPrefixWidth(line) >= blockPrefixWidth(above);
}

function addParagraphAbove(lines: readonly string[], underline: number, chosen: Set<number>): void {
  for (let above = underline - 1; above >= 0; above -= 1) {
    if (chosen.has(above)) return;
    if (blank(lines, above)) return;
    chosen.add(above);
  }
}

function addRunAround(lines: readonly string[], index: number, chosen: Set<number>): void {
  for (let above = index; above >= 0 && !blank(lines, above); above -= 1) chosen.add(above);
  for (let below = index + 1; below < lines.length && !blank(lines, below); below += 1) {
    chosen.add(below);
  }
}

export function headingSignature(markdown: string): string {
  const lines = markdown.split('\n');
  const chosen = new Set<number>();

  for (const [index, line] of lines.entries()) {
    const content = blockContent(line);
    if (ATX_HEADING.test(content) || FENCE.test(content)) {
      chosen.add(index);
      continue;
    }
    if (underlinesAParagraph(lines, index)) {
      chosen.add(index);
      addParagraphAbove(lines, index, chosen);
      continue;
    }
    if (RAW_HTML.test(line)) addRunAround(lines, index, chosen);
  }

  return [...chosen]
    .sort((left, right) => left - right)
    .map((index) => `${index}:${lines[index] ?? ''}`)
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
