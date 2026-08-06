import type { DocHeading } from './outline.ts';

export const HEADING_SELECTOR = 'h1, h2, h3';

const ACTIVE_BAND = 96;

export function headingElementsIn(container: HTMLElement | null): HTMLElement[] {
  if (container === null) return [];
  return [...container.querySelectorAll<HTMLElement>(HEADING_SELECTOR)];
}

export function headingAt(container: HTMLElement | null, index: number): HTMLElement | null {
  return headingElementsIn(container)[index] ?? null;
}

export function activeHeadingIndex(tops: readonly number[], scrollTop: number): number {
  let active = -1;
  for (const [index, top] of tops.entries()) {
    if (top - scrollTop > ACTIVE_BAND) break;
    active = index;
  }
  return active === -1 && tops.length > 0 ? 0 : active;
}

export function activeHeadingId(
  headings: readonly DocHeading[],
  tops: readonly number[],
  scrollTop: number,
): string | null {
  const index = activeHeadingIndex(tops, scrollTop);
  return index === -1 ? null : (headings[index]?.id ?? null);
}
