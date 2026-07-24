import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectedAccounts } from './connected-accounts.tsx';
import { LAST_CREDENTIAL_MESSAGE } from './credentials.ts';
import type { ConnectedAccountView } from './data.ts';

const refresh = mock();
const linkSocial = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh, push: mock() }),
}));

mock.module('@/lib/auth/client.ts', () => ({
  authClient: {
    linkSocial: (...args: unknown[]) => linkSocial(...args),
  },
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

const GITHUB: ConnectedAccountView = {
  id: 'account-1',
  providerId: 'github',
  accountId: 'gh-42',
  connectedAt: '2026-04-01T00:00:00.000Z',
};

const GOOGLE: ConnectedAccountView = {
  id: 'account-2',
  providerId: 'google',
  accountId: 'goog-7',
  connectedAt: '2026-04-02T00:00:00.000Z',
};

const realFetch = globalThis.fetch;

function mockFetch(status: number, body: unknown): void {
  globalThis.fetch = mock(() =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  refresh.mockClear();
  linkSocial.mockReset();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('ConnectedAccounts', () => {
  it('shows the linked provider with its account label and a connect action for the other', () => {
    render(
      <ConnectedAccounts
        accounts={[GITHUB]}
        passkeyCount={1}
        availableProviders={['github', 'google']}
      />,
    );

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Account gh-42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disconnect/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Connect/ })).toBeEnabled();
  });

  it('blocks disconnecting the only sign in method and explains why', () => {
    render(
      <ConnectedAccounts
        accounts={[GITHUB]}
        passkeyCount={0}
        availableProviders={['github', 'google']}
      />,
    );

    expect(screen.getByText(LAST_CREDENTIAL_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disconnect/ })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('allows disconnecting once a second provider exists', async () => {
    mockFetch(200, { removed: 'account' });
    const user = userEvent.setup();
    render(
      <ConnectedAccounts
        accounts={[GITHUB, GOOGLE]}
        passkeyCount={0}
        availableProviders={['github', 'google']}
      />,
    );

    expect(screen.queryByText(LAST_CREDENTIAL_MESSAGE)).toBeNull();
    const [firstDisconnect] = screen.getAllByRole('button', { name: /Disconnect/ });
    await user.click(firstDisconnect as HTMLElement);

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces a server side refusal inline', async () => {
    mockFetch(409, { error: { code: 'conflict', message: LAST_CREDENTIAL_MESSAGE } });
    const user = userEvent.setup();
    render(
      <ConnectedAccounts
        accounts={[GITHUB, GOOGLE]}
        passkeyCount={0}
        availableProviders={['github', 'google']}
      />,
    );

    const [firstDisconnect] = screen.getAllByRole('button', { name: /Disconnect/ });
    await user.click(firstDisconnect as HTMLElement);

    expect(await screen.findByRole('alert')).toHaveTextContent(LAST_CREDENTIAL_MESSAGE);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('disables connect for a provider this server has not configured', () => {
    render(<ConnectedAccounts accounts={[GITHUB]} passkeyCount={1} availableProviders={[]} />);
    expect(screen.getByRole('button', { name: /Connect/ })).toBeDisabled();
    expect(screen.getByText('Google is not configured on this server.')).toBeInTheDocument();
  });

  it('starts the provider link flow', async () => {
    linkSocial.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(
      <ConnectedAccounts
        accounts={[GITHUB]}
        passkeyCount={1}
        availableProviders={['github', 'google']}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Connect/ }));

    await waitFor(() => {
      expect(linkSocial).toHaveBeenCalledWith({
        provider: 'google',
        callbackURL: '/settings/account/connections',
        errorCallbackURL: '/settings/account/connections',
      });
    });
  });
});
