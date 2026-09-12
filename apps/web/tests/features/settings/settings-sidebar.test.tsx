import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as navigation from 'next/navigation';
import { SettingsSidebar } from '@/features/settings/settings-sidebar.tsx';
import { SettingsNavProvider } from '@/features/settings/use-settings-nav.ts';
import { HotkeyProvider } from '@/lib/keyboard/index.ts';
import { DESKTOP_QUERY } from '@/lib/use-media-query.ts';

const pathname = mock(() => '/settings/general');
const close = mock();

mock.module('next/navigation', () => ({
  ...navigation,
  usePathname: pathname,
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock(), back: mock() }),
}));

function mockViewport(desktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: desktop && query === DESKTOP_QUERY,
      media: query,
      onchange: null,
      addEventListener: mock(),
      removeEventListener: mock(),
      addListener: mock(),
      removeListener: mock(),
      dispatchEvent: mock(),
    }),
  });
}

function restoreViewport() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: mock(),
      removeEventListener: mock(),
      addListener: mock(),
      removeListener: mock(),
      dispatchEvent: mock(),
    }),
  });
}

function renderSidebar(passwordEnabled: boolean, open: boolean) {
  return render(
    <HotkeyProvider>
      <SettingsNavProvider
        value={{
          open,
          toggle: mock(),
          close,
        }}
      >
        <SettingsSidebar passwordEnabled={passwordEnabled} />
      </SettingsNavProvider>
    </HotkeyProvider>,
  );
}

function keyboardFocusLink(name: string) {
  return screen.getByRole('link', { name });
}

describe('SettingsSidebar', () => {
  afterEach(() => {
    restoreViewport();
  });

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

  it('moves keyboard focus down and up the sidebar with j and k on desktop', async () => {
    mockViewport(true);
    pathname.mockReturnValue('/settings/general');
    const user = userEvent.setup();
    renderSidebar(false, false);

    expect(keyboardFocusLink('General')).toHaveAttribute('data-keyboard-focus', 'true');

    await user.keyboard('j');
    expect(keyboardFocusLink('Members')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('General')).not.toHaveAttribute('data-keyboard-focus');

    await user.keyboard('k');
    expect(keyboardFocusLink('General')).toHaveAttribute('data-keyboard-focus', 'true');

    await user.keyboard('{ArrowDown}');
    expect(keyboardFocusLink('Members')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('General')).not.toHaveAttribute('data-keyboard-focus');

    await user.keyboard('{ArrowUp}');
    expect(keyboardFocusLink('General')).toHaveAttribute('data-keyboard-focus', 'true');
  });

  it('ignores j and k when the mobile drawer is closed', async () => {
    mockViewport(false);
    pathname.mockReturnValue('/settings/general');
    const user = userEvent.setup();
    renderSidebar(false, false);

    await user.keyboard('j');

    expect(keyboardFocusLink('General')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('Members')).not.toHaveAttribute('data-keyboard-focus');
  });

  it('moves keyboard focus when the mobile drawer is open', async () => {
    mockViewport(false);
    pathname.mockReturnValue('/settings/general');
    const user = userEvent.setup();
    renderSidebar(false, true);

    await user.keyboard('j');

    expect(keyboardFocusLink('Members')).toHaveAttribute('data-keyboard-focus', 'true');
  });

  it('advances from the tab-focused link with arrows and j k', async () => {
    mockViewport(true);
    pathname.mockReturnValue('/settings/general');
    const user = userEvent.setup();
    renderSidebar(false, false);

    await user.tab();

    expect(keyboardFocusLink('Profile')).toHaveFocus();
    expect(keyboardFocusLink('Profile')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('General')).not.toHaveAttribute('data-keyboard-focus');

    await user.keyboard('{ArrowDown}');
    expect(keyboardFocusLink('Connected accounts')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('Connected accounts')).toHaveFocus();
    expect(keyboardFocusLink('Members')).not.toHaveAttribute('data-keyboard-focus');

    await user.keyboard('j');
    expect(keyboardFocusLink('Passkeys')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('Passkeys')).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(keyboardFocusLink('Connected accounts')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('Connected accounts')).toHaveFocus();

    await user.keyboard('k');
    expect(keyboardFocusLink('Profile')).toHaveAttribute('data-keyboard-focus', 'true');
    expect(keyboardFocusLink('Profile')).toHaveFocus();
  });

  it('focuses the target link so enter can activate it natively', async () => {
    mockViewport(true);
    pathname.mockReturnValue('/settings/general');
    const user = userEvent.setup();
    renderSidebar(false, false);

    await user.keyboard('j');

    expect(keyboardFocusLink('Members')).toHaveFocus();
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
      <HotkeyProvider>
        <SettingsNavProvider
          value={{
            open: true,
            toggle: mock(),
            close,
          }}
        >
          <SettingsSidebar passwordEnabled={false} />
        </SettingsNavProvider>
      </HotkeyProvider>,
    );

    expect(screen.getByTestId('settings-sidebar').className).toContain('fixed');
  });
});
