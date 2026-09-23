import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as navigation from 'next/navigation';
import { render, screen } from '@/test/render.tsx';
import { mockSession } from '../../../../../tests-support.ts';

const getPendingMcpConsent = mock(() =>
  Promise.resolve({
    clientId: 'trusted-client',
    scope: ['openid', 'orbit.read'],
    userId: 'user-1',
  }),
);
const getMcpClient = mock(() =>
  Promise.resolve({ clientId: 'trusted-client', name: 'Trusted Client', icon: null }),
);
const listOrganizationsForUser = mock(() =>
  Promise.resolve([{ organization: { id: 'org-1', name: 'Nova' } }]),
);
const listSelectablePersonalAgents = mock(() => Promise.resolve([]));
const userHasPasskey = mock(() => Promise.resolve(false));

mock.module('@orbit/core', () => ({
  getPendingMcpConsent,
  getMcpClient,
  listOrganizationsForUser,
  listSelectablePersonalAgents,
  userHasPasskey,
}));

mock.module('next/navigation', () => ({
  ...navigation,
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

mockSession(() => ({ user: { id: 'user-1', email: 'person@orbit.test' } }));

const { default: AuthorizePage } = await import(
  '../../../../../src/app/(auth)/oauth/authorize/page.tsx'
);

const initialIdentityRead = process.env['ORBIT_AGENT_IDENTITY_READ'];
const initialConsent = process.env['ORBIT_AGENT_CONSENT'];

afterAll(() => {
  if (initialIdentityRead === undefined) delete process.env['ORBIT_AGENT_IDENTITY_READ'];
  else process.env['ORBIT_AGENT_IDENTITY_READ'] = initialIdentityRead;
  if (initialConsent === undefined) delete process.env['ORBIT_AGENT_CONSENT'];
  else process.env['ORBIT_AGENT_CONSENT'] = initialConsent;
});

beforeEach(() => {
  process.env['ORBIT_AGENT_IDENTITY_READ'] = 'true';
  process.env['ORBIT_AGENT_CONSENT'] = 'true';
  getPendingMcpConsent.mockClear();
  getMcpClient.mockClear();
  listOrganizationsForUser.mockClear();
  listSelectablePersonalAgents.mockClear();
  userHasPasskey.mockClear();
});

describe('OAuth authorize page', () => {
  it('renders the client and scopes from the pending consent record', async () => {
    render(
      await AuthorizePage({
        searchParams: Promise.resolve({
          consent_code: 'consent-1',
          client_id: 'tampered-client',
          scope: 'orbit.write',
        }),
      }),
    );

    expect(screen.getByText('Trusted Client')).toBeVisible();
    expect(
      screen.getByText('Read your issues, projects, sprints, docs, and workspace members'),
    ).toBeVisible();
    expect(
      screen.queryByText('Create and update issues, comments, projects, and sprints'),
    ).toBeNull();
    expect(getMcpClient).toHaveBeenCalledWith('trusted-client');
    expect(listSelectablePersonalAgents).toHaveBeenCalledWith('user-1', 'org-1', 'trusted-client');
  });

  it('does not expose identity reads while either required gate is closed', async () => {
    process.env['ORBIT_AGENT_IDENTITY_READ'] = 'false';

    render(
      await AuthorizePage({
        searchParams: Promise.resolve({ consent_code: 'consent-1' }),
      }),
    );

    expect(screen.getByText(/authorization link is invalid or has expired/i)).toBeVisible();
    expect(getPendingMcpConsent).not.toHaveBeenCalled();
    expect(listSelectablePersonalAgents).not.toHaveBeenCalled();
  });
});
