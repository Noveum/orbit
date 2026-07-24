import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { DocsSkeleton, NewDocSkeleton } from './docs-skeleton.tsx';

describe('docs skeletons', () => {
  it('renders the docs workspace skeleton', () => {
    render(<DocsSkeleton />);
    expect(screen.getByTestId('docs-skeleton')).toBeInTheDocument();
  });

  it('renders the new doc skeleton', () => {
    render(<NewDocSkeleton />);
    expect(screen.getByTestId('new-doc-skeleton')).toBeInTheDocument();
  });
});
