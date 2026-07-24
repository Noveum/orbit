import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { PullsSkeleton } from './pulls-skeleton.tsx';

describe('pulls skeleton', () => {
  it('renders the pulls skeleton', () => {
    render(<PullsSkeleton />);
    expect(screen.getByTestId('pulls-skeleton')).toBeInTheDocument();
  });
});
