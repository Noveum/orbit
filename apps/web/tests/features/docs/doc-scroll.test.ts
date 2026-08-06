import { afterEach, describe, expect, it } from 'bun:test';
import { scrollContainerOf } from '../../../src/features/docs/doc-scroll.ts';

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
