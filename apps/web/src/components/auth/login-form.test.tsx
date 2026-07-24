import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { LoginForm } from './login-form.tsx';

const requestPasswordReset = mock();

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
  },
}));

beforeEach(() => {
  requestPasswordReset.mockReset();
});

function renderForm(passwordEnabled: boolean) {
  render(
    <ToastProvider>
      <LoginForm providers={[]} passwordEnabled={passwordEnabled} />
    </ToastProvider>,
  );
}

describe('LoginForm', () => {
  it('renders no password field while password auth is off', () => {
    renderForm(false);
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByText('Create an account with a password')).toBeNull();
    expect(screen.getByLabelText('Email address')).toBeDefined();
    expect(screen.getByText('Continue with passkey')).toBeDefined();
  });

  it('offers sign in and sign up once password auth is on', () => {
    renderForm(true);
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('minlength', '12');
    expect(screen.getByText('Sign in with password')).toBeDefined();
    expect(screen.getByText('Create an account with a password')).toBeDefined();
    expect(screen.getByText('Email me a link')).toBeDefined();
    expect(screen.getByText('Continue with passkey')).toBeDefined();
  });

  it('hides the forgot password affordance while password auth is off', () => {
    renderForm(false);
    expect(screen.queryByText('Forgot password?')).toBeNull();
  });

  it('offers a forgot password link once password auth is on', () => {
    renderForm(true);
    expect(screen.getByText('Forgot password?')).toBeDefined();
  });

  it('requests a password reset for the entered email', async () => {
    requestPasswordReset.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderForm(true);

    await user.type(screen.getByLabelText('Email address'), 'ada@orbit.local');
    await user.click(screen.getByText('Forgot password?'));

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledWith({
        email: 'ada@orbit.local',
        redirectTo: '/reset-password',
      });
    });
  });
});
