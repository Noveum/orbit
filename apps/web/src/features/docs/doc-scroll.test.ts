import { afterEach, describe, expect, it } from 'bun:test';
import { scrollContainerOf, scrollHeadingIntoView } from './doc-scroll.ts';

function fixedRect(el: Element, top: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, bottom: top + 24, left: 0, right: 0, width: 200, height: 24 }) as DOMRect,
  });
}

function scrollableContainer(scrollTop: number): HTMLDivElement {
  const container = document.createElement('div');
  container.style.overflowY = 'auto';
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 500 });
  container.scrollTop = scrollTop;
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('scrollContainerOf', () => {
  it('finds the nearest scrollable ancestor across a non-scrolling wrapper', () => {
    const container = scrollableContainer(0);
    const wrapper = document.createElement('div');
    const heading = document.createElement('h2');
    heading.id = 'rules';
    wrapper.appendChild(heading);
    container.appendChild(wrapper);
    document.body.appendChild(container);

    expect(scrollContainerOf(heading)).toBe(container);
  });

  it('returns null when no ancestor scrolls, so the window is used', () => {
    const heading = document.createElement('h2');
    heading.id = 'rules';
    document.body.appendChild(heading);

    expect(scrollContainerOf(heading)).toBeNull();
  });
});

describe('scrollHeadingIntoView inside a nested scroll container', () => {
  it('scrolls the container to the target measured against the container, not the viewport', () => {
    const scrolls: number[] = [];
    const container = scrollableContainer(120);
    Object.defineProperty(container, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        if (typeof options?.top === 'number') scrolls.push(options.top);
      },
    });
    fixedRect(container, 100);

    const above = document.createElement('h2');
    above.id = 'intro';
    fixedRect(above, 300);
    const target = document.createElement('h2');
    target.id = 'rules';
    fixedRect(target, 700);

    container.appendChild(above);
    container.appendChild(target);
    document.body.appendChild(container);

    scrollHeadingIntoView('rules');

    expect(scrolls).toEqual([120 + (700 - 100) - 96]);
    expect(scrolls).not.toContain(120 + (300 - 100) - 96);
  });
});
