import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@/test/render.tsx';

const passkey = mock(async () => ({ error: { message: 'The passkey prompt was dismissed.' } }));

mock.module('@/lib/auth/client.ts', () => ({ authClient: { signIn: { passkey } } }));

const { ConsentForm } = await import(
  '../../../../../src/app/(auth)/oauth/authorize/consent-form.tsx'
);

const props = {
  consentCode: 'code_1',
  clientId: 'client_1',
  clientName: 'Northwind Desktop',
  scope: 'openid orbit.read',
  scopes: ['openid', 'orbit.read'],
  organizations: [{ id: 'org_1', name: 'Noveum' }],
  agents: [
    {
      id: 'agent_1',
      organizationId: 'org_1',
      name: 'Researcher',
      avatar: null,
      hasActiveGrant: false,
    },
  ],
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
let currentLocation: ReturnType<typeof mockLocationAssign> | undefined;

function mockLocationAssign() {
  const originalLocation = window.location;
  const originalUrl = originalLocation.href;
  const assign = mock((_url: string) => undefined);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign },
    writable: true,
  });
  return {
    assign,
    restore: () => {
      window.happyDOM.setURL(originalUrl);
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
    },
  };
}

function currentLocationMock() {
  if (currentLocation === undefined) throw new Error('The location mock is not initialized.');
  return currentLocation;
}

beforeEach(() => {
  currentLocation = mockLocationAssign();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  passkey.mockClear();
  currentLocation?.restore();
  currentLocation = undefined;
});

describe('when approving cannot be completed', () => {
  it('requires an explicit identity choice and separate confirmation before replacing a connection', async () => {
    const sent = answerWith([{ redirectUri: 'https://northwind.example/cb?code=abc' }]);
    const firstAgent = props.agents[0];
    if (firstAgent === undefined) throw new Error('missing agent fixture');
    render(<ConsentForm {...props} agents={[{ ...firstAgent, hasActiveGrant: true }]} />);
    const approve = screen.getByRole('button', { name: /approve/i });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: /agent identity/i }), {
      target: { value: firstAgent.id },
    });
    expect(approve).toBeDisabled();
    expect(sent).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: /replace.*connection/i }));
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain('"replaceActiveGrant":true');
  });

  it('submits the selected identity with an approval decision', async () => {
    const sent = answerWith([{ redirectUri: 'https://northwind.example/cb?code=abc' }]);
    render(<ConsentForm {...props} />);
    const approve = screen.getByRole('button', { name: /approve/i });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: /agent identity/i }), {
      target: { value: 'agent_1' },
    });
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain('"identitySelection":{"agentIdentityId":"agent_1"');
  });

  it('requires a choice from the initial workspace when agents arrive in another order', async () => {
    const sent = answerWith([{ redirectUri: 'https://northwind.example/cb?code=abc' }]);
    const firstAgent = props.agents[0];
    if (firstAgent === undefined) throw new Error('missing agent fixture');
    render(
      <ConsentForm
        {...props}
        organizations={[
          { id: 'org_1', name: 'Noveum' },
          { id: 'org_2', name: 'Other' },
        ]}
        agents={[{ ...firstAgent, id: 'agent_2', organizationId: 'org_2' }, firstAgent]}
      />,
    );
    const approve = screen.getByRole('button', { name: /approve/i });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: /agent identity/i }), {
      target: { value: 'agent_1' },
    });
    fireEvent.click(approve);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain('"organizationId":"org_1"');
    expect(sent[0]).toContain('"identitySelection":{"agentIdentityId":"agent_1"');
  });

  it('returns to the client with a denial when that way out is taken', async () => {
    render(<ConsentForm {...props} />);

    const sent = answerWith([{ redirectUri: 'https://northwind.example/cb?error=access_denied' }]);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => expect(currentLocationMock().assign).toHaveBeenCalled());
    expect(currentLocationMock().assign.mock.calls[0]?.[0]).toContain('error=access_denied');
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
    expect(currentLocationMock().assign).not.toHaveBeenCalled();
    expect(screen.queryByTestId('consent-blocked')).toBeNull();
  });

  it('follows a successful code redirect after approval', async () => {
    const sent = answerWith([{ redirectUri: 'https://northwind.example/cb?code=abc&state=st' }]);
    render(<ConsentForm {...props} />);
    fireEvent.change(screen.getByRole('combobox', { name: /agent identity/i }), {
      target: { value: 'agent_1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() =>
      expect(currentLocationMock().assign).toHaveBeenCalledWith(
        'https://northwind.example/cb?code=abc&state=st',
      ),
    );
    expect(sent).toHaveLength(1);
  });
});
