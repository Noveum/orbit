import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { restoreModulesAfterThisFile } from '../../../tests-support.ts';

const requestPasswordReset = mock();
const sendVerificationOtp = mock();
const signInEmailOtp = mock();
const toast = mock();
const originalLocation = window.location;
const assign = mock();

await restoreModulesAfterThisFile(['@/components/ui/toast.tsx']);

Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...window.location, assign },
});

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => sendVerificationOtp(...args),
    },
    signIn: {
      emailOtp: (...args: unknown[]) => signInEmailOtp(...args),
    },
  },
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const { LoginForm } = await import('../../../src/components/auth/login-form.tsx');

beforeEach(() => {
  requestPasswordReset.mockReset();
  sendVerificationOtp.mockReset();
  signInEmailOtp.mockReset();
  toast.mockReset();
  assign.mockReset();
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

function renderForm(passwordEnabled: boolean) {
  render(<LoginForm providers={[]} passwordEnabled={passwordEnabled} />);
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
    expect(screen.getByText('Email me a code')).toBeDefined();
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

  it('sends a sign in code to the entered email', async () => {
    sendVerificationOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText('Email address'), 'ada@orbit.local');
    await user.click(screen.getByText('Email me a code'));

    await waitFor(() => {
      expect(sendVerificationOtp).toHaveBeenCalledWith({
        email: 'ada@orbit.local',
        type: 'sign-in',
      });
    });
    expect(screen.getByLabelText('Sign in code')).toBeDefined();
    expect(screen.getByText('Verify code')).toBeDefined();
  });

  it('shows an error for an invalid emailed code', async () => {
    sendVerificationOtp.mockResolvedValue({ error: null });
    signInEmailOtp.mockResolvedValue({ error: { message: 'Invalid code' } });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText('Email address'), 'ada@orbit.local');
    await user.click(screen.getByText('Email me a code'));
    await user.type(await screen.findByLabelText('Sign in code'), '123456');
    await user.click(screen.getByText('Verify code'));

    await waitFor(() => {
      expect(signInEmailOtp).toHaveBeenCalledWith({
        email: 'ada@orbit.local',
        otp: '123456',
      });
    });
    expect(toast).toHaveBeenCalledWith({
      title: 'Sign in failed',
      description: 'Invalid code',
      tone: 'danger',
    });
  });

  it('signs in with a valid emailed code', async () => {
    sendVerificationOtp.mockResolvedValue({ error: null });
    signInEmailOtp.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderForm(false);

    await user.type(screen.getByLabelText('Email address'), 'ada@orbit.local');
    await user.click(screen.getByText('Email me a code'));
    await user.type(await screen.findByLabelText('Sign in code'), '123456');
    await user.click(screen.getByText('Verify code'));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/my-issues');
    });
    expect(signInEmailOtp).toHaveBeenCalledTimes(1);
  });

  it('verifies the code when Enter is pressed with password auth enabled', async () => {
    sendVerificationOtp.mockResolvedValue({ error: null });
    signInEmailOtp.mockResolvedValue({ error: { message: 'Invalid code' } });
    const user = userEvent.setup();
    renderForm(true);

    await user.type(screen.getByLabelText('Email address'), 'ada@orbit.local');
    await user.click(screen.getByText('Email me a code'));
    const code = await screen.findByLabelText('Sign in code');
    await user.type(code, '123456{Enter}');

    await waitFor(() => {
      expect(signInEmailOtp).toHaveBeenCalledWith({
        email: 'ada@orbit.local',
        otp: '123456',
      });
    });
  });
});
