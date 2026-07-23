export interface DocHeading {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const INLINE_MARKS = /[*_`~]/g;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length === 0 ? 'section' : base;
}

export function outlineOf(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const used = new Map<string, number>();
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = HEADING.exec(line);
    if (match === null) continue;
    const hashes = match[1];
    const raw = match[2];
    if (hashes === undefined || raw === undefined) continue;

    const text = raw.replace(LINK, '$1').replace(INLINE_MARKS, '').trim();
    if (text.length === 0) continue;

    const base = slugify(text);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    headings.push({ id: seen === 0 ? base : `${base}-${seen}`, text, level: hashes.length });
  }

  return headings;
}

export function readTimeMinutes(markdown: string): number {
  const words = markdown
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return Math.max(1, Math.round(words / 220));
}
