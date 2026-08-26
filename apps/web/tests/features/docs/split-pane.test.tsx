import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import userEvent from '@testing-library/user-event';
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  SplitPane,
} from '@/features/docs/split-pane.tsx';
import { cleanup, fireEvent, render, screen } from '@/test/render.tsx';

const STORAGE_KEY = 'orbit:test:split';

function measure(width: number, left = 0): void {
  const pane = screen.getByTestId('split-pane');
  pane.getBoundingClientRect = () =>
    ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0 }) as DOMRect;
}

function basis(): number {
  const first = screen.getByTestId('first-pane').parentElement;
  const value = first?.style.flexBasis ?? '';
  return Number.parseFloat(value.replace('%', ''));
}

function renderSplit(): void {
  render(
    <SplitPane
      storageKey={STORAGE_KEY}
      label="Resize source and preview"
      first={<div data-testid="first-pane">source</div>}
      second={<div data-testid="second-pane">preview</div>}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  if (typeof Element.prototype.setPointerCapture !== 'function') {
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('the split ratio', () => {
  it('stays inside the range the handle can reach', () => {
    expect(clampSplitRatio(0)).toBe(MIN_SPLIT_RATIO);
    expect(clampSplitRatio(1)).toBe(MAX_SPLIT_RATIO);
    expect(clampSplitRatio(0.5)).toBe(0.5);
  });

  it('falls back to an even split when the stored value is not a number', () => {
    expect(clampSplitRatio(Number.NaN)).toBe(DEFAULT_SPLIT_RATIO);
    expect(clampSplitRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLIT_RATIO);
  });
});

describe('the split pane', () => {
  it('opens on an even split with a handle between the two panes', () => {
    renderSplit();

    expect(screen.getByTestId('first-pane')).toBeInTheDocument();
    expect(screen.getByTestId('second-pane')).toBeInTheDocument();
    expect(basis()).toBe(DEFAULT_SPLIT_RATIO * 100);
    expect(screen.getByTestId('split-pane-handle').getAttribute('aria-valuenow')).toBe('50');
  });

  it('drops the handle when only one pane is shown', () => {
    render(
      <SplitPane
        storageKey={STORAGE_KEY}
        label="Resize source and preview"
        first={null}
        second={<div data-testid="second-pane">preview</div>}
      />,
    );

    expect(screen.getByTestId('second-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('split-pane-handle')).toBeNull();
  });

  it('moves the boundary to where the pointer is dragged', () => {
    renderSplit();
    measure(1000);
    const handle = screen.getByTestId('split-pane-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });

    expect(basis()).toBeCloseTo(70, 5);

    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0.7000');
  });

  it('refuses to drag a pane past the limits', () => {
    renderSplit();
    measure(1000);
    const handle = screen.getByTestId('split-pane-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40 });
    expect(basis()).toBeCloseTo(MIN_SPLIT_RATIO * 100, 5);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 4000 });
    expect(basis()).toBeCloseTo(MAX_SPLIT_RATIO * 100, 5);
  });

  it('measures from the left edge of the panes, not the window', () => {
    renderSplit();
    measure(1000, 200);
    const handle = screen.getByTestId('split-pane-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 700 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });

    expect(basis()).toBeCloseTo(70, 5);
  });

  it('moves a step at a time from the keyboard and jumps to either end', async () => {
    const user = userEvent.setup();
    renderSplit();
    const handle = screen.getByTestId('split-pane-handle');

    expect(handle.tabIndex).toBe(0);
    handle.focus();
    expect(handle).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(basis()).toBeCloseTo(52, 5);

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(basis()).toBeCloseTo(48, 5);

    await user.keyboard('{End}');
    expect(basis()).toBeCloseTo(MAX_SPLIT_RATIO * 100, 5);

    await user.keyboard('{Home}');
    expect(basis()).toBeCloseTo(MIN_SPLIT_RATIO * 100, 5);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0.2000');
  });

  it('names the panes it resizes for a screen reader', () => {
    renderSplit();
    const handle = screen.getByTestId('split-pane-handle');
    const controls = (handle.getAttribute('aria-controls') ?? '').split(' ');

    expect(controls).toHaveLength(2);
    expect(document.getElementById(controls[0] ?? '')).toContainElement(
      screen.getByTestId('first-pane'),
    );
    expect(document.getElementById(controls[1] ?? '')).toContainElement(
      screen.getByTestId('second-pane'),
    );
  });

  it('goes back to an even split on a double click', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderSplit();
    const handle = screen.getByTestId('split-pane-handle');

    fireEvent.keyDown(handle, { key: 'End' });
    expect(basis()).toBeCloseTo(MAX_SPLIT_RATIO * 100, 5);

    await user.dblClick(handle);

    expect(basis()).toBe(DEFAULT_SPLIT_RATIO * 100);
  });

  it('opens at the width the last drag left behind', () => {
    window.localStorage.setItem(STORAGE_KEY, '0.35');
    renderSplit();

    expect(basis()).toBeCloseTo(35, 5);
  });

  it('ignores a stored value that is out of range or unreadable', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not a ratio');
    renderSplit();
    expect(basis()).toBe(DEFAULT_SPLIT_RATIO * 100);

    cleanup();
    window.localStorage.setItem(STORAGE_KEY, '9');
    renderSplit();
    expect(basis()).toBeCloseTo(MAX_SPLIT_RATIO * 100, 5);
  });
});
