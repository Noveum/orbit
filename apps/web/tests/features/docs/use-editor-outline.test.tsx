import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { useEditorOutline } from '../../../src/features/docs/use-editor-outline.ts';

const realRequestFrame = globalThis.requestAnimationFrame;
const realCancelFrame = globalThis.cancelAnimationFrame;

let frames: FrameRequestCallback[] = [];
let cancelled: number[] = [];

beforeEach(() => {
  frames = [];
  cancelled = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((handle: number) => {
    cancelled.push(handle);
  }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRequestFrame;
  globalThis.cancelAnimationFrame = realCancelFrame;
});

function Harness() {
  const scroller = useRef<HTMLDivElement | null>(null);
  const { activeId } = useEditorOutline('# One\n\n## Two\n', scroller);
  return (
    <div data-testid="scroller" ref={scroller}>
      <h1 id="one">One</h1>
      <h2 id="two">Two</h2>
      <p data-testid="active">{activeId ?? 'none'}</p>
    </div>
  );
}

function placeHeadings(container: HTMLElement, tops: readonly number[]): void {
  const headings = [...container.querySelectorAll('h1, h2')];
  headings.forEach((heading, index) => {
    Object.defineProperty(heading, 'offsetTop', {
      value: tops[index] ?? 0,
      configurable: true,
    });
  });
}

function runNextFrame(): void {
  const frame = frames.at(-1);
  act(() => {
    frame?.(0);
  });
}

describe('the scroll spy behind the editor outline', () => {
  it('measures once per animation frame however many scroll events arrive', () => {
    const view = render(<Harness />);
    const scroller = view.getByTestId('scroller');
    const active = view.getByTestId('active');
    expect(active.textContent).toBe('two');

    placeHeadings(view.container, [0, 800]);
    act(() => {
      for (let event = 0; event < 5; event += 1) {
        scroller.dispatchEvent(new Event('scroll'));
      }
    });

    expect(frames).toHaveLength(1);
    expect(active.textContent).toBe('two');

    runNextFrame();
    expect(active.textContent).toBe('one');

    view.unmount();
  });

  it('schedules again once the frame it was waiting for has run', () => {
    const view = render(<Harness />);
    const scroller = view.getByTestId('scroller');

    placeHeadings(view.container, [0, 800]);
    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    runNextFrame();

    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scroll'));
    });

    expect(frames).toHaveLength(2);
    view.unmount();
  });

  it('drops a pending frame when the editor goes away', () => {
    const view = render(<Harness />);
    const scroller = view.getByTestId('scroller');

    act(() => {
      scroller.dispatchEvent(new Event('scroll'));
    });
    view.unmount();

    expect(cancelled).toEqual([1]);
  });
});
