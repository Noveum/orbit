'use client';

export const HEADING_SCROLL_OFFSET = 96;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node !== null) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function headingOffsetWithin(target: HTMLElement, container: HTMLElement | null): number {
  const targetTop = target.getBoundingClientRect().top;
  if (container === null) return window.scrollY + targetTop;
  return container.scrollTop + (targetTop - container.getBoundingClientRect().top);
}

export function scrollHeadingIntoView(id: string, offset: number = HEADING_SCROLL_OFFSET): void {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(id);
  if (target === null) return;
  const container = scrollContainerOf(target);
  const top = Math.max(0, headingOffsetWithin(target, container) - offset);
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (container === null) {
    window.scrollTo({ top, behavior });
    return;
  }
  container.scrollTo({ top, behavior });
}
