import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';
import { ResetPasswordForm } from './reset-password-form.tsx';

const resetPassword = mock();
const toast = mock();
const push = mock();

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    resetPassword: (...args: unknown[]) => resetPassword(...args),
  },
}));

mock.module('next/navigation', () => ({
  useRouter: () => ({ push, refresh: mock() }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

mock.module('next/link', () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

const PASSWORD = 'correct-horse-battery';

beforeEach(() => {
  resetPassword.mockReset();
  toast.mockClear();
  push.mockClear();
});

describe('ResetPasswordForm', () => {
  it('resets the password with the token and lands back on login', async () => {
    resetPassword.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<ResetPasswordForm token="tok-123" />);

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith({ newPassword: PASSWORD, token: 'tok-123' });
    });
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('shows a friendly message and no form when the token is missing', () => {
    render(<ResetPasswordForm token={null} />);
    expect(screen.getByTestId('reset-invalid')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('keeps submit disabled until both fields match at the minimum length', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="tok-123" />);

    await user.type(screen.getByLabelText('New password'), PASSWORD);
    await user.type(screen.getByLabelText('Confirm new password'), 'short');

    expect(screen.getByRole('button', { name: 'Reset password' })).toBeDisabled();
  });
});
