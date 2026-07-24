import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { IssueDetailSkeleton } from './issue-detail-skeleton.tsx';

describe('IssueDetailSkeleton', () => {
  it('renders the issue detail skeleton', () => {
    const { getByTestId } = render(<IssueDetailSkeleton />);
    expect(getByTestId('issue-detail-skeleton')).toBeInTheDocument();
  });
});
