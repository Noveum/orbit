import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { InboxSkeleton } from './inbox-skeleton.tsx';

describe('InboxSkeleton', () => {
  it('renders the inbox skeleton', () => {
    const { getByTestId } = render(<InboxSkeleton />);
    expect(getByTestId('inbox-skeleton')).toBeInTheDocument();
  });
});
