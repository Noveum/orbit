import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingInviteView, TeamBadge } from './data.ts';
import { InvitePanel, parseEmails } from './invite-panel.tsx';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const TEAMS: TeamBadge[] = [{ id: 'team-1', key: 'ENG', name: 'Engineering' }];

const INVITES: PendingInviteView[] = [
  {
    id: 'invite-1',
    email: 'pending@noveum.ai',
    role: 'member',
    teamIds: [],
    expiresAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-18T00:00:00.000Z',
  },
];

beforeEach(() => {
  refresh.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseEmails', () => {
  it('splits on commas, semicolons and whitespace and dedupes', () => {
    expect(parseEmails('a@b.com, a@b.com; c@d.com\ne@f.com')).toEqual({
      valid: ['a@b.com', 'c@d.com', 'e@f.com'],
      invalid: [],
    });
  });

  it('separates addresses that are not valid emails', () => {
    expect(parseEmails('ok@b.com, nope')).toEqual({ valid: ['ok@b.com'], invalid: ['nope'] });
  });
});

describe('InvitePanel', () => {
  it('rejects an invalid address before sending anything', async () => {
    const user = userEvent.setup();
    render(<InvitePanel teams={TEAMS} invites={[]} canInvite />);

    await user.type(screen.getByLabelText('Email addresses'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send invites' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not a valid email address: not-an-email',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the pending count and confirms after sending', async () => {
    const user = userEvent.setup();
    render(<InvitePanel teams={TEAMS} invites={[]} canInvite />);

    await user.type(screen.getByLabelText('Email addresses'), 'one@noveum.ai, two@noveum.ai');
    expect(screen.getByText('2 addresses ready to invite.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send invites' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invites sent to one@noveum.ai, two@noveum.ai.',
    );
    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('lists pending invites with resend and revoke', () => {
    render(<InvitePanel teams={TEAMS} invites={INVITES} canInvite />);
    expect(screen.getByText('pending@noveum.ai')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
  });

  it('disables everything when the viewer cannot invite', () => {
    render(<InvitePanel teams={TEAMS} invites={INVITES} canInvite={false} />);
    expect(screen.getByLabelText('Email addresses')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send invites' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
  });
});
