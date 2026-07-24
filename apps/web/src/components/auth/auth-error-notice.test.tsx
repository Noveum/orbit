import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import { AuthErrorNotice } from './auth-error-notice.tsx';

const replace = mock();
const toast = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ replace, push: mock(), refresh: mock() }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

beforeEach(() => {
  replace.mockReset();
  toast.mockReset();
  window.history.replaceState({}, '', '/login');
});

describe('AuthErrorNotice', () => {
  it('toasts a friendly message for the callback error code', async () => {
    window.history.replaceState({}, '', '/login?error=access_denied');
    render(<AuthErrorNotice code="access_denied" />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const options = toast.mock.calls[0]?.[0] as {
      description: string;
      tone: string;
      title: string;
    };
    expect(options.tone).toBe('danger');
    expect(options.title).toBe('Sign in failed');
    expect(options.description).toContain('cancelled');
  });

  it('uses a custom title when provided', async () => {
    window.history.replaceState({}, '', "/settings/account/connections?error=email_doesn't_match");
    render(<AuthErrorNotice code="email_doesn't_match" title="Couldn't connect account" />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const options = toast.mock.calls[0]?.[0] as { title: string };
    expect(options.title).toBe("Couldn't connect account");
  });

  it('strips the error params from the URL after showing it', async () => {
    window.history.replaceState(
      {},
      '',
      '/login?error=access_denied&error_description=nope&next=/x',
    );
    render(<AuthErrorNotice code="access_denied" />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const target = replace.mock.calls[0]?.[0] as string;
    expect(target).not.toContain('error');
    expect(target).toContain('next=%2Fx');
  });
});
