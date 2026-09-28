import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingInviteView, TeamBadge } from '../../../src/features/settings/data.ts';
import { InvitePanel, parseEmails } from '../../../src/features/settings/invite-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
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

const realFetch = globalThis.fetch;

beforeEach(() => {
  refresh.mockClear();
  globalThis.fetch = mock(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
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

  it('deduplicates addresses after normalization', () => {
    expect(parseEmails('Ada@Example.com; ada@example.com\nADA@EXAMPLE.COM')).toEqual({
      valid: ['ada@example.com'],
      invalid: [],
    });
  });
});

describe('InvitePanel', () => {
  it('lets an admin invite another admin', async () => {
    render(<InvitePanel teams={TEAMS} invites={[]} canInvite canInviteAdmins />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email addresses'), 'new-admin@example.com');
    await user.click(screen.getByRole('combobox', { name: 'Invite role' }));
    await user.click(screen.getByRole('option', { name: 'Admin' }));
    await user.click(screen.getByRole('button', { name: 'Send invites' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      '/api/invites',
      expect.objectContaining({
        body: JSON.stringify({
          invites: [{ email: 'new-admin@example.com', role: 'admin', teamIds: [] }],
        }),
      }),
    );
  });

  it('drops an admin selection when admin invitation permission is removed', async () => {
    const { rerender } = render(
      <InvitePanel teams={TEAMS} invites={[]} canInvite canInviteAdmins />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email addresses'), 'teammate@example.com');
    await user.click(screen.getByRole('combobox', { name: 'Invite role' }));
    await user.click(screen.getByRole('option', { name: 'Admin' }));
    rerender(<InvitePanel teams={TEAMS} invites={[]} canInvite canInviteAdmins={false} />);
    expect(screen.getByRole('combobox', { name: 'Invite role' })).toHaveTextContent('Member');
    await user.click(screen.getByRole('button', { name: 'Send invites' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      '/api/invites',
      expect.objectContaining({
        body: JSON.stringify({
          invites: [{ email: 'teammate@example.com', role: 'member', teamIds: [] }],
        }),
      }),
    );
  });

  it('does not offer admin invitations to an ordinary member', async () => {
    render(<InvitePanel teams={TEAMS} invites={[]} canInvite />);
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Invite role' }));
    expect(screen.queryByRole('option', { name: 'Admin' }) === null).toBe(true);
    expect(screen.getByRole('option', { name: 'Contributor' })).toBeVisible();
  });

  it('sends one invitation when pasted addresses differ only in case', async () => {
    render(<InvitePanel teams={TEAMS} invites={[]} canInvite />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email addresses'), 'Ada@Example.com, ada@example.com');
    expect(screen.getByText('1 address ready to invite.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Send invites' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      '/api/invites',
      expect.objectContaining({
        body: JSON.stringify({
          invites: [{ email: 'ada@example.com', role: 'member', teamIds: [] }],
        }),
      }),
    );
  });

  it('disables send and resend without email while retaining revocation', () => {
    render(<InvitePanel teams={TEAMS} invites={INVITES} canInvite emailEnabled={false} />);
    expect(screen.getByRole('button', { name: 'Send invites' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });
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
