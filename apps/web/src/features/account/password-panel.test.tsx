import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordPanel } from './password-panel.tsx';

const refresh = mock();
const toast = mock();
const changePassword = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh, push: mock() }),
}));

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    changePassword: (...args: unknown[]) => changePassword(...args),
  },
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const realFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown): ReturnType<typeof mock> {
  const spy = mock(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  changePassword.mockReset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('PasswordPanel', () => {
  it('offers to set a password when the user has no credential', () => {
    render(<PasswordPanel hasPassword={false} />);
    expect(screen.getByRole('button', { name: 'Set password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('offers to change the password when the user already has one', () => {
    render(<PasswordPanel hasPassword={true} />);
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('posts a new password when setting one', async () => {
    const fetchSpy = mockFetch(200, { ok: true });
    const user = userEvent.setup();
    render(<PasswordPanel hasPassword={false} />);

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('/api/account/password');
    expect(JSON.parse(init.body)).toEqual({ newPassword: PASSWORD });
  });

  it('changes the password and revokes other sessions', async () => {
    changePassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<PasswordPanel hasPassword={true} />);

    await user.type(screen.getByLabelText('Current password'), 'old-password-here');
    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: 'old-password-here',
        newPassword: PASSWORD,
        revokeOtherSessions: true,
      });
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the submit disabled while the confirmation does not match', async () => {
    const user = userEvent.setup();
    render(<PasswordPanel hasPassword={false} />);

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), 'different-enough-value');

    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  });
});
