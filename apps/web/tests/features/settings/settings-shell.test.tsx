import { describe, expect, it, mock } from 'bun:test';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as navigation from 'next/navigation';
import { SettingsShell } from '@/features/settings/settings-shell.tsx';

const pathname = mock(() => '/settings/general');

mock.module('next/navigation', () => ({
  ...navigation,
  usePathname: pathname,
}));

describe('SettingsShell', () => {
  it('renders page content beside the settings sidebar', () => {
    pathname.mockReturnValue('/settings/general');
    render(
      <SettingsShell passwordEnabled={false}>
        <p>General content</p>
      </SettingsShell>,
    );

    expect(screen.getByText('General content')).toBeInTheDocument();
    expect(screen.getByTestId('settings-sidebar')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
  });

  it('marks the active workspace section in the sidebar', () => {
    pathname.mockReturnValue('/settings/general');
    render(
      <SettingsShell passwordEnabled={false}>
        <p>General content</p>
      </SettingsShell>,
    );

    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveAttribute('aria-current');
  });

  it('marks the active account section in the sidebar', () => {
    pathname.mockReturnValue('/settings/account/sessions');
    render(
      <SettingsShell passwordEnabled={false}>
        <p>Sessions content</p>
      </SettingsShell>,
    );

    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Teams' })).not.toHaveAttribute('aria-current');
  });

  it('opens and closes the mobile drawer from the toolbar toggle', async () => {
    pathname.mockReturnValue('/settings/general');
    const user = userEvent.setup();
    render(
      <SettingsShell passwordEnabled={false}>
        <p>General content</p>
      </SettingsShell>,
    );

    const sidebar = screen.getByTestId('settings-sidebar');
    expect(sidebar.className).toContain('hidden');

    await user.click(screen.getByTestId('toggle-settings-sections'));
    expect(sidebar.className).toContain('fixed');

    await user.click(screen.getByTestId('toggle-settings-sections'));
    expect(sidebar.className).toContain('hidden');
  });
});
