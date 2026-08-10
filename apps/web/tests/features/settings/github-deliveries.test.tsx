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
      screen.getByText(/Of the last 3 deliveries, 2 arrived and changed nothing/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Its branch and title name no issue')).toHaveLength(2);
  });

  it('calls a failed delivery failed rather than one that changed nothing', () => {
    render(
      <GithubDeliveries
        deliveries={[delivery({ id: 'a', status: 'failed' }), delivery({ id: 'b' })]}
      />,
    );

    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
    expect(screen.queryByText(/1 arrived and changed nothing/)).toBeNull();
  });

  it('does not pass a delivery that never recorded an outcome off as one that changed nothing', () => {
    render(
      <GithubDeliveries
        deliveries={[delivery({ id: 'a', status: 'received' }), delivery({ id: 'b' })]}
      />,
    );

    expect(screen.getByText(/1 recorded no outcome/)).toBeInTheDocument();
    expect(screen.queryByText(/1 arrived and changed nothing/)).toBeNull();
  });

  it('names all three outcomes when a batch carries a mix of them', () => {
    render(
      <GithubDeliveries
        deliveries={[
          delivery({ id: 'a', status: 'ignored', reason: 'no_issue_identifier' }),
          delivery({ id: 'b', status: 'failed' }),
          delivery({ id: 'c', status: 'received' }),
          delivery({ id: 'd' }),
        ]}
      />,
    );

    const summary = screen.getByText(/Of the last 4 deliveries/);
    expect(summary.textContent).toContain('1 arrived and changed nothing');
    expect(summary.textContent).toContain('1 failed');
    expect(summary.textContent).toContain('1 recorded no outcome');
  });

  it('shows the status, the event and when it arrived on the row itself', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(
      <GithubDeliveries
        deliveries={[
          delivery({
            id: 'del_1',
            status: 'ignored',
            event: 'pull_request_review',
            reason: 'no_matching_issue',
            receivedAt: twoHoursAgo,
          }),
        ]}
      />,
    );

    const row = screen.getByTestId('github-delivery-del_1');
    expect(row.textContent).toContain('ignored');
    expect(row.textContent).toContain('pull_request_review');
    expect(row.textContent).toContain('2h');
    expect(row.textContent).toContain('It names an issue this workspace does not have');
  });

  it('does not call a failed delivery one that landed', () => {
    render(
      <GithubDeliveries
        deliveries={[delivery({ id: 'a', status: 'failed' }), delivery({ id: 'b' })]}
      />,
    );

    expect(
      screen.queryByText('Every recent delivery changed something in Orbit.'),
    ).not.toBeInTheDocument();
  });

  it('says so plainly when every delivery landed', () => {
    render(<GithubDeliveries deliveries={[delivery()]} />);

    expect(
      screen.getByText('Every recent delivery changed something in Orbit.'),
    ).toBeInTheDocument();
  });
});
