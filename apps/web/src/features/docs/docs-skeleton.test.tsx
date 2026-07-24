import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { DocPaneSkeleton, NewDocSkeleton } from './docs-skeleton.tsx';

describe('docs skeletons', () => {
  it('renders the doc content pane skeleton', () => {
    render(<DocPaneSkeleton />);
    expect(screen.getByTestId('doc-pane-skeleton')).toBeInTheDocument();
  });

  it('renders the new doc skeleton', () => {
    render(<NewDocSkeleton />);
    expect(screen.getByTestId('new-doc-skeleton')).toBeInTheDocument();
  });
});
