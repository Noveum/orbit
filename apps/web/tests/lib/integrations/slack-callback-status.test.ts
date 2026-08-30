import { describe, expect, it } from 'bun:test';
import { conflict, forbidden } from '@orbit/shared/errors';
import { slackCallbackStatusForFailure } from '@/lib/integrations/slack-callback-status.ts';

describe('Slack OAuth callback status', () => {
  it('reports when another Orbit workspace owns the Slack team', () => {
    const error = conflict(
      'That Slack workspace is already connected to another Orbit workspace.',
      {
        details: { reason: 'slack_team_claimed' },
      },
    );

    expect(slackCallbackStatusForFailure(error)).toBe('claimed');
  });

  it('keeps authorization and provider failures distinct', () => {
    expect(slackCallbackStatusForFailure(forbidden())).toBe('denied');
    expect(slackCallbackStatusForFailure(new Error('provider failed'))).toBe('error');
  });
});
