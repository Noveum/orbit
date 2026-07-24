import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { LoginForm } from './login-form.tsx';

function renderForm(passwordEnabled: boolean, errorMessage?: string) {
  render(
    <ToastProvider>
      <LoginForm
        providers={[]}
        passwordEnabled={passwordEnabled}
        {...(errorMessage === undefined ? {} : { errorMessage })}
      />
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

  it('shows a graceful alert when a sign in error is passed', () => {
    renderForm(false, 'That email is outside the organizations allowed to use this Orbit.');
    const alert = screen.getByTestId('login-error');
    expect(alert).toHaveTextContent('outside the organizations allowed');
    expect(alert).toHaveAttribute('role', 'alert');
  });

  it('renders no alert without an error', () => {
    renderForm(false);
    expect(screen.queryByTestId('login-error')).toBeNull();
  });
});
