import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import * as navigation from 'next/navigation';
import type { MembershipContext } from '@/lib/auth/principal.ts';
import type { ActiveSession } from '@/lib/auth/session.ts';

const sessionHolder: { value: ActiveSession | null } = { value: null };
const membershipHolder: { value: MembershipContext | null } = { value: null };

mock.module('@/lib/auth/session.ts', () => ({
  requireSession: async () => {
    await Promise.resolve();
    if (sessionHolder.value === null) throw new Error('redirect:/login');
    return sessionHolder.value;
  },
}));

mock.module('@/lib/auth/principal.ts', () => ({
  resolveMembership: async () => {
    await Promise.resolve();
    return membershipHolder.value;
  },
}));

mock.module('next/navigation', () => ({
  ...navigation,
  usePathname: () => '/settings/general',
}));

import { HotkeyProvider } from '@/lib/keyboard/index.ts';

process.env['BETTER_AUTH_SECRET'] = 'test-secret-value-32-chars-minimum-length-spec';

const { default: SettingsLayout } = await import('@/app/(app)/settings/layout.tsx');

function renderLayout(ui: React.ReactNode) {
  return render(<HotkeyProvider>{ui}</HotkeyProvider>);
}

describe('SettingsLayout', () => {
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
    membershipHolder.value = {
      ...membershipHolder.value!,
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
