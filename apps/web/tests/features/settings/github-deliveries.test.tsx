import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import type { GithubDeliveryView } from '@/features/settings/integrations-data.ts';
import {
  deliveryReasonCopy,
  GithubDeliveries,
} from '../../../src/features/settings/github-deliveries.tsx';

function delivery(overrides: Partial<GithubDeliveryView> = {}): GithubDeliveryView {
  return {
    id: 'del_1',
    event: 'pull_request',
    status: 'processed',
    reason: null,
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('deliveryReasonCopy', () => {
  it('says what each reason means in words somebody can act on', () => {
    expect(deliveryReasonCopy('no_issue_identifier')).toBe('Its branch and title name no issue');
    expect(deliveryReasonCopy('repository_not_connected')).toBe(
      'That repository is not connected here',
    );
  });

  it('falls back to the raw reason rather than hiding an unknown one', () => {
    expect(deliveryReasonCopy('something_new')).toBe('something_new');
  });

  it('says nothing when a delivery was not ignored', () => {
    expect(deliveryReasonCopy(null)).toBe('');
  });
});

describe('GithubDeliveries', () => {
  it('renders nothing at all when no delivery has ever arrived', () => {
    const { container } = render(<GithubDeliveries deliveries={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('counts the deliveries that arrived and changed nothing', () => {
    render(
      <GithubDeliveries
        deliveries={[
          delivery({ id: 'a', status: 'ignored', reason: 'no_issue_identifier' }),
          delivery({ id: 'b', status: 'ignored', reason: 'no_issue_identifier' }),
          delivery({ id: 'c' }),
        ]}
      />,
    );

    expect(
      screen.getByText(/2 of the last 3 deliveries arrived and changed nothing/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Its branch and title name no issue')).toHaveLength(2);
  });

  it('says so plainly when every delivery landed', () => {
    render(<GithubDeliveries deliveries={[delivery()]} />);

    expect(
      screen.getByText('Every recent delivery changed something in Orbit.'),
    ).toBeInTheDocument();
  });
});
