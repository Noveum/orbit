const originalAuthSecret = process.env['BETTER_AUTH_SECRET'];
process.env['BETTER_AUTH_SECRET'] ??= 'test-secret-value-32-chars-minimum-length-spec';

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import type { ActiveSession } from '@/lib/auth/session.ts';

const { mockMembership, mockSession } = await import('../../../tests-support.ts');
const { HotkeyProvider } = await import('@/lib/keyboard/index.ts');

const sessionHolder: { value: ActiveSession | null } = { value: null };
const membershipHolder: { value: MembershipContext | null } = { value: null };

mockSession(() => sessionHolder.value);
mockMembership(() => membershipHolder.value);

mock.module('next/navigation', () => ({
  ...navigation,
  usePathname: () => '/settings/general',
}));

const { default: SettingsLayout } = await import('@/app/(app)/settings/layout.tsx');

function renderLayout(ui: React.ReactNode) {
  return render(<HotkeyProvider>{ui}</HotkeyProvider>);
}

describe('SettingsLayout', () => {
  afterAll(() => {
    if (originalAuthSecret === undefined) delete process.env['BETTER_AUTH_SECRET'];
    else process.env['BETTER_AUTH_SECRET'] = originalAuthSecret;
  });

  beforeEach(() => {
    const now = new Date();
    sessionHolder.value = {
      user: {
        id: 'user-1',
        name: 'User One',
        email: 'user1@example.com',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now,
      },
      session: {
        id: 'session-1',
        userId: 'user-1',
        activeOrganizationId: 'org-1',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 86400000),
        token: 'token-1',
      },
    };
    membershipHolder.value = {
      principal: {
        userId: 'user-1',
        organizationId: 'org-1',
        role: 'admin',
        teamIds: [],
      },
      memberId: 'mem-1',
      organizationName: 'Org',
      organizationSlug: 'org',
      deletionRequestedAt: null,
    };
  });

  it('renders layout children and shows AI settings for an admin', async () => {
    renderLayout(
      await SettingsLayout({
        children: <div data-testid="settings-child">Child Component</div>,
      }),
    );

    expect(screen.getByTestId('settings-child')).toHaveTextContent('Child Component');
    expect(screen.queryByRole('link', { name: 'AI provider' })).not.toBeNull();
  });

  it('hides AI provider link and sets canManageAi to false when workspace deletion is pending', async () => {
    const current = membershipHolder.value;
    if (current === null) throw new Error('membership expected');
    membershipHolder.value = {
      ...current,
      deletionRequestedAt: new Date(),
    };

    renderLayout(
      await SettingsLayout({
        children: <div data-testid="settings-child">Child Component</div>,
      }),
    );

    expect(screen.getByTestId('settings-child')).toHaveTextContent('Child Component');
    expect(screen.queryByRole('link', { name: 'AI provider' })).toBeNull();
  });

  it('hides AI provider link when user has no active membership', async () => {
    membershipHolder.value = null;

    renderLayout(
      await SettingsLayout({
        children: <div data-testid="settings-child">Child Component</div>,
      }),
    );

    expect(screen.getByTestId('settings-child')).toHaveTextContent('Child Component');
    expect(screen.queryByRole('link', { name: 'AI provider' })).toBeNull();
  });
});
