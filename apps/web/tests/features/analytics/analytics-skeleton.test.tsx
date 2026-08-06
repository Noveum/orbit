import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { AnalyticsSkeleton } from '../../../src/features/analytics/analytics-skeleton.tsx';

describe('analytics skeleton', () => {
  it('renders the analytics skeleton', () => {
    render(<AnalyticsSkeleton />);
    expect(screen.getByTestId('analytics-skeleton')).toBeInTheDocument();
  });
});
