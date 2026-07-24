import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ViewsSkeleton } from './views-skeleton.tsx';

describe('views skeleton', () => {
  it('renders the views skeleton', () => {
    render(<ViewsSkeleton />);
    expect(screen.getByTestId('views-skeleton')).toBeInTheDocument();
  });
});
