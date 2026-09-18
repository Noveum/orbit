import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@orbit/shared/constants';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  channelTypeKey,
  NotificationChannels,
  type SlackDmAvailability,
} from '../../../src/features/settings/notification-channels.tsx';

let sentBody: Record<string, unknown> | null = null;

const realFetch = globalThis.fetch;
const VISIBLE_CHANNELS = NOTIFICATION_CHANNELS.filter((channel) => channel !== 'slack');

beforeEach(() => {
  sentBody = null;
  globalThis.fetch = mock((_url: string, init: { body?: string }) => {
    sentBody = init.body === undefined ? null : JSON.parse(init.body);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderChannels(
  disabledKeys: string[] = [],
  slackDm: SlackDmAvailability = 'available',
): void {
  render(
    <NotificationChannels
      disabledKeys={disabledKeys}
      quietHoursEnabled
      quietHoursStart="18:00"
      quietHoursEnd="09:00"
      urgentBypassEnabled
      slackDm={slackDm}
    />,
  );
}

function savedPreferences(): { channel: string; type: string; enabled: boolean }[] {
  return (sentBody as { preferences: { channel: string; type: string; enabled: boolean }[] })
    .preferences;
}

function disabledAfterSave(): string[] {
  return savedPreferences()
    .filter((entry) => !entry.enabled)
    .map((entry) => channelTypeKey(entry.channel, entry.type))
    .sort();
}

describe('NotificationChannels', () => {
  it('shows one master switch per channel and no per type control until a channel is opened', () => {
    renderChannels();

    expect(screen.getAllByRole('switch')).toHaveLength(VISIBLE_CHANNELS.length + 2);
    expect(screen.getByLabelText('Inbox notifications')).toBeVisible();
    expect(screen.getByLabelText('Email notifications')).toBeVisible();
    expect(screen.getByLabelText('Slack DM notifications')).toBeVisible();
    expect(screen.getByLabelText('Push notifications')).toBeVisible();
    expect(screen.queryByLabelText('Email for Mention')).toBeNull();
  });

  it('summarises how much of each channel is on', () => {
    renderChannels([channelTypeKey('email', 'mention'), channelTypeKey('email', 'reaction')]);

    expect(
      screen.getAllByText(`On for all ${NOTIFICATION_TYPES.length} notifications.`).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        `On for ${NOTIFICATION_TYPES.length - 2} of ${NOTIFICATION_TYPES.length} notifications.`,
      ),
    ).toBeVisible();
  });

  it('reveals every notification type for the channel being customised', async () => {
    const user = userEvent.setup();
    renderChannels();

    await user.click(screen.getByLabelText('Customize Email'));

    expect(screen.getAllByRole('switch')).toHaveLength(
      VISIBLE_CHANNELS.length + 2 + NOTIFICATION_TYPES.length,
    );
    expect(screen.getByLabelText('Email for Mention')).toHaveAttribute('data-state', 'checked');
    expect(screen.queryByLabelText('Push for Mention')).toBeNull();
  });

  it('reflects a disabled preference as an off switch inside the panel', async () => {
    const user = userEvent.setup();
    renderChannels([channelTypeKey('email', 'mention')]);

    await user.click(screen.getByLabelText('Customize Email'));

    expect(screen.getByLabelText('Email for Mention')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByLabelText('Email for New comment')).toHaveAttribute('data-state', 'checked');
  });

  it('turns a whole channel off and restores the earlier picks when it is turned back on', async () => {
    const user = userEvent.setup();
    renderChannels([channelTypeKey('email', 'mention')]);

    await user.click(screen.getByLabelText('Email notifications'));
    expect(screen.getByText('Off for every notification.')).toBeVisible();

    await user.click(screen.getByLabelText('Email notifications'));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });
    expect(disabledAfterSave()).toEqual([channelTypeKey('email', 'mention')]);
  });

  it('saves a channel that was switched off as every type disabled', async () => {
    const user = userEvent.setup();
    renderChannels();

    await user.click(screen.getByLabelText('Push notifications'));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });
    expect(disabledAfterSave()).toEqual(
      NOTIFICATION_TYPES.map((type) => channelTypeKey('push', type)).sort(),
    );
  });

  it('turns one group on or off without touching the rest of the channel', async () => {
    const user = userEvent.setup();
    renderChannels();

    await user.click(screen.getByLabelText('Customize Email'));
    await user.click(screen.getByLabelText('Turn off every Workspace notification for Email'));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });
    expect(disabledAfterSave()).toEqual(
      [channelTypeKey('email', 'invite_accepted'), channelTypeKey('email', 'member_joined')].sort(),
    );
  });

  it('keeps Slack out of notification settings while the capability is disabled', async () => {
    const user = userEvent.setup();
    renderChannels([], 'disabled');

    expect(screen.queryByText('Slack DM')).toBeNull();
    expect(screen.queryByLabelText('Slack DM notifications')).toBeNull();
    expect(screen.queryByText(/Slack DMs/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });
    expect(savedPreferences().some((entry) => entry.channel.startsWith('slack'))).toBe(false);
  });

  it('explains when Slack DMs are unavailable and locks the channel', () => {
    renderChannels([], 'unavailable');

    expect(
      screen.getByText('Slack DMs are unavailable until Slack is connected for this workspace.'),
    ).toBeVisible();
    expect(screen.getByLabelText('Slack DM notifications')).toBeDisabled();
    expect(screen.getByLabelText('Customize Slack DM')).toBeDisabled();
  });

  it('does not overwrite Slack DM preferences while Slack is unavailable', async () => {
    const user = userEvent.setup();
    renderChannels([], 'unavailable');

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });
    expect(savedPreferences().some((entry) => entry.channel === 'slack_dm')).toBe(false);
  });

  it('stops claiming preferences are saved once quiet hours change again', async () => {
    const user = userEvent.setup();
    renderChannels();

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Notification preferences saved.')).toBeVisible();

    await user.click(screen.getByLabelText('Quiet hours'));
    expect(screen.queryByText('Notification preferences saved.')).toBeNull();
  });

  it('stops claiming preferences are saved once urgent bypass changes again', async () => {
    const user = userEvent.setup();
    renderChannels();

    await user.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(await screen.findByText('Notification preferences saved.')).toBeVisible();

    await user.click(screen.getByLabelText('Urgent bypass'));
    expect(screen.queryByText('Notification preferences saved.')).toBeNull();
  });

  it('does not promise to hold Slack DMs during quiet hours when Slack cannot deliver', () => {
    renderChannels([], 'unavailable');

    expect(
      screen.getByText('Email is held until the window ends, in your local time.'),
    ).toBeVisible();
    expect(screen.queryByText(/Email and Slack DMs are held/)).toBeNull();
  });

  it('promises to hold Slack DMs during quiet hours only when Slack can deliver', () => {
    renderChannels([], 'available');

    expect(
      screen.getByText('Email and Slack DMs are held until the window ends, in your local time.'),
    ).toBeVisible();
  });

  it('round trips every channel and the quiet hours settings on save', async () => {
    const user = userEvent.setup();
    renderChannels();

    await user.click(screen.getByLabelText('Customize Push'));
    await user.click(screen.getByLabelText('Push for Mention'));
    await user.click(screen.getByLabelText('Quiet hours'));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(sentBody).not.toBeNull();
    });
    const body = sentBody as unknown as {
      preferences: { channel: string; type: string; enabled: boolean }[];
      quietHoursEnabled: boolean;
      quietHoursStart: string;
      urgentBypassEnabled: boolean;
    };

    expect(body.preferences).toHaveLength(VISIBLE_CHANNELS.length * NOTIFICATION_TYPES.length);
    expect(body.preferences.some((entry) => entry.channel === 'slack')).toBe(false);
    expect(disabledAfterSave()).toEqual([channelTypeKey('push', 'mention')]);
    expect(body.quietHoursEnabled).toBe(false);
    expect(body.quietHoursStart).toBe('18:00');
    expect(body.urgentBypassEnabled).toBe(true);

    expect(await screen.findByRole('status')).toHaveTextContent('Notification preferences saved.');
  });
});
