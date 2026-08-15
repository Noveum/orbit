import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { useMeasuredWidth } from '../../src/lib/use-measured-width.ts';

describe('useMeasuredWidth', () => {
  it('returns the fallback width when ResizeObserver is not available', () => {
    function TestComponent() {
      const { ref, width } = useMeasuredWidth(640);
      return <div ref={ref}>{width}</div>;
    }

    const { container } = render(<TestComponent />);
    const element = container.querySelector('div');
    expect(element?.textContent).toBe('640');
  });

  it('attaches ref to the div element', () => {
    function TestComponent() {
      const { ref } = useMeasuredWidth();
      return <div ref={ref} data-testid="measured-div" />;
    }

    render(<TestComponent />);
    const element = screen.getByTestId('measured-div');
    expect(element).toBeInstanceOf(HTMLDivElement);
  });
});
