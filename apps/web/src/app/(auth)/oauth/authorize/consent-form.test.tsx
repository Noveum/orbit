import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@/test/render.tsx';

const passkey = mock(async () => ({ error: { message: 'The passkey prompt was dismissed.' } }));

mock.module('@/lib/auth/client.ts', () => ({ authClient: { signIn: { passkey } } }));

const { ConsentForm } = await import('./consent-form.tsx');

const props = {
  consentCode: 'code_1',
  clientId: 'client_1',
  clientName: 'Northwind Desktop',
  scope: 'openid orbit.read',
  scopes: ['openid', 'orbit.read'],
  organizations: [{ id: 'org_1', name: 'Noveum' }],
  requirePasskey: true,
  userEmail: 'pulkit@noveum.ai',
};

function answerWith(replies: readonly Record<string, unknown>[]): string[] {
  const sent: string[] = [];
  let call = 0;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(String(init?.body ?? ''));
    const body = replies[Math.min(call, replies.length - 1)] ?? {};
    call += 1;
    return Promise.resolve(Response.json(body, { status: 200 }));
  }) as typeof fetch;
  return sent;
}

const originalFetch = globalThis.fetch;
const assign = mock((_url: string) => undefined);
Object.defineProperty(window, 'location', {
  value: { ...window.location, assign },
  writable: true,
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  passkey.mockClear();
  assign.mockClear();
});

describe('when approving cannot be completed', () => {
  it('offers a way back to the client instead of leaving it waiting', async () => {
    answerWith([{ status: 'passkey_required' }]);
    render(<ConsentForm {...props} />);

    expect(screen.queryByTestId('consent-blocked')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(screen.getByTestId('consent-blocked')).toBeTruthy());
    expect(
      screen.getByRole('button', { name: /cancel and return to Northwind Desktop/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/prompts you to verify with your passkey/i)).toBeNull();
  });

  it('returns to the client with a denial when that way out is taken', async () => {
    answerWith([{ status: 'passkey_required' }]);
    render(<ConsentForm {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(screen.getByTestId('consent-blocked')).toBeTruthy());

    const sent = answerWith([{ redirectUri: 'https://northwind.example/cb?error=access_denied' }]);
    fireEvent.click(
      screen.getByRole('button', { name: /cancel and return to Northwind Desktop/i }),
    );

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign.mock.calls[0]?.[0]).toContain('error=access_denied');
    expect(sent[0]).toContain('"decision":"deny"');
  });

  it('does not raise the blocked panel when denying is what failed', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ error: { code: 'server_error', message: 'boom' } }, { status: 500 }),
      )) as unknown as typeof fetch;
    render(<ConsentForm {...props} />);

    const deny = screen.getByRole('button', { name: /deny/i });
    fireEvent.click(deny);
    await waitFor(() => expect(deny).toBeDisabled());
    await waitFor(() => expect(deny).not.toBeDisabled());
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByTestId('consent-blocked')).toBeNull();
  });

  it('redirects to the client when approving succeeds', async () => {
    answerWith([{ redirectUri: 'https://northwind.example/cb?code=abc&state=st' }]);
    render(<ConsentForm {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign.mock.calls[0]?.[0]).toContain('code=abc');
    expect(screen.queryByTestId('consent-blocked')).toBeNull();
  });
});
