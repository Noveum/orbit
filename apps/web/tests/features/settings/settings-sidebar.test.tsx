import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as navigation from 'next/navigation';
import { SettingsSidebar } from '@/features/settings/settings-sidebar.tsx';
import { SettingsNavProvider } from '@/features/settings/use-settings-nav.ts';

const pathname = mock(() => '/settings/general');
const close = mock();

mock.module('next/navigation', () => ({
  ...navigation,
  usePathname: pathname,
}));

function renderSidebar(passwordEnabled: boolean, open: boolean) {
  return render(
    <SettingsNavProvider
      value={{
        open,
        toggle: mock(),
        close,
      }}
    >
      <SettingsSidebar passwordEnabled={passwordEnabled} />
    </SettingsNavProvider>,
  );
}

describe('SettingsSidebar', () => {
  it('lists account and workspace sections separately', () => {
    pathname.mockReturnValue('/settings/general');
    renderSidebar(false, false);

    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/settings/account',
    );
    expect(screen.getByRole('link', { name: 'MCP server' })).toHaveAttribute(
      'href',
      '/settings/mcp',
    );
  });

  it('marks the active account section', () => {
    pathname.mockReturnValue('/settings/account/passkeys');
    renderSidebar(false, false);

    expect(screen.getByRole('link', { name: 'Passkeys' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
  });

  it('includes the password section when password auth is enabled', () => {
    pathname.mockReturnValue('/settings/account');
    renderSidebar(true, false);

    expect(screen.getByRole('link', { name: 'Password' })).toHaveAttribute(
      'href',
      '/settings/account/password',
    );
  });

  it('closes the drawer when a section is chosen', async () => {
    pathname.mockReturnValue('/settings/general');
    close.mockClear();
    const user = userEvent.setup();
    renderSidebar(false, true);

    await user.click(screen.getByRole('link', { name: 'Members' }));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer from the mobile backdrop', async () => {
    pathname.mockReturnValue('/settings/general');
    close.mockClear();
    const user = userEvent.setup();
    renderSidebar(false, true);

    await user.click(screen.getByRole('button', { name: 'Close settings sections' }));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps the sidebar hidden on small screens until the drawer opens', () => {
    pathname.mockReturnValue('/settings/general');
    const closed = renderSidebar(false, false);
    expect(screen.getByTestId('settings-sidebar').className).toContain('hidden');

    closed.rerender(
      <SettingsNavProvider
        value={{
          open: true,
          toggle: mock(),
          close,
        }}
      >
        <SettingsSidebar passwordEnabled={false} />
      </SettingsNavProvider>,
    );

    expect(screen.getByTestId('settings-sidebar').className).toContain('fixed');
  });
});
