import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { CycleSkeleton } from './cycle-skeleton.tsx';

describe('CycleSkeleton', () => {
  it('renders the cycles skeleton', () => {
    const { getByTestId } = render(<CycleSkeleton />);
    expect(getByTestId('cycles-skeleton')).toBeInTheDocument();
  });

  it('renders a single panel when asked', () => {
    const { getByTestId } = render(<CycleSkeleton panels={1} />);
    expect(getByTestId('cycles-skeleton')).toBeInTheDocument();
  });
});
