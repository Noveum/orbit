import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import {
  SlackConnectNotice,
  slackConnectStatusOf,
} from '../../../src/features/settings/slack-connect-notice.tsx';

describe('SlackConnectNotice', () => {
  it('accepts only callback statuses', () => {
    expect(slackConnectStatusOf('connected')).toBe('connected');
    expect(slackConnectStatusOf('error')).toBe('error');
    expect(slackConnectStatusOf('denied')).toBe('denied');
    expect(slackConnectStatusOf('claimed')).toBe('claimed');
    expect(slackConnectStatusOf('<script>alert(1)</script>')).toBeNull();
    expect(slackConnectStatusOf(['claimed'])).toBeNull();
  });

  it('explains how to recover from a claimed Slack workspace', () => {
    render(<SlackConnectNotice status="claimed" />);

    expect(screen.getByRole('status')).toHaveTextContent(/already connected to another Orbit/);
    expect(screen.getByRole('status')).toHaveTextContent(/Disconnect it there first/);
  });
});
