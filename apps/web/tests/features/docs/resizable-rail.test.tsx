import { afterEach, beforeEach, expect, it } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResizableRail } from '@/features/docs/resizable-rail.tsx';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function rail() {
  return render(
    <ResizableRail storageKey="test:rail" label="Resize sidebar">
      <div>Navigation</div>
    </ResizableRail>,
  );
}

it('persists keyboard resizing and restores it on reload', () => {
  const view = rail();
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '272');
  view.unmount();
  rail();
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '272');
});

it('clamps stored widths and resets on double click', () => {
  window.localStorage.setItem('test:rail', '999999');
  rail();
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '440');
  fireEvent.doubleClick(screen.getByRole('separator'));
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '256');
});

it('supports both limits from the keyboard', () => {
  rail();
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '180');
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'End' });
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '440');
});
