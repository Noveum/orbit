import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@orbit/shared/constants';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matrixKey, NotificationMatrix } from './notification-matrix.tsx';

let sentBody: Record<string, unknown> | null = null;

beforeEach(() => {
  sentBody = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: { body?: string }) => {
      sentBody = init.body === undefined ? null : JSON.parse(init.body);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderMatrix(disabledKeys: string[] = []) {
  render(
    <NotificationMatrix
      disabledKeys={disabledKeys}
      quietHoursEnabled
      quietHoursStart="18:00"
      quietHoursEnd="09:00"
      urgentBypassEnabled
    />,
  );
}

describe('NotificationMatrix', () => {
  it('renders a checkbox for every channel and type pair', () => {
    renderMatrix();
    const expected = NOTIFICATION_CHANNELS.length * NOTIFICATION_TYPES.length;
    expect(screen.getAllByRole('checkbox')).toHaveLength(expected);
  });

  it('reflects disabled preferences as unchecked boxes', () => {
    renderMatrix([matrixKey('email', 'mention')]);
    expect(screen.getByLabelText('Email for Mention')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByLabelText('Inbox for Mention')).toHaveAttribute('data-state', 'checked');
  });

  it('round trips the full matrix and the quiet hours settings on save', async () => {
    const user = userEvent.setup();
    renderMatrix([matrixKey('slack', 'reaction')]);

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

    expect(body.preferences).toHaveLength(NOTIFICATION_CHANNELS.length * NOTIFICATION_TYPES.length);
    const disabled = body.preferences
      .filter((entry) => !entry.enabled)
      .map((entry) => matrixKey(entry.channel, entry.type))
      .sort();
    expect(disabled).toEqual([matrixKey('push', 'mention'), matrixKey('slack', 'reaction')].sort());
    expect(body.quietHoursEnabled).toBe(false);
    expect(body.quietHoursStart).toBe('18:00');
    expect(body.urgentBypassEnabled).toBe(true);

    expect(await screen.findByRole('status')).toHaveTextContent('Notification preferences saved.');
  });
});
