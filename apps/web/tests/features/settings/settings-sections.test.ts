import { describe, expect, it } from 'bun:test';
import { SETTINGS_GROUPS, settingsGroupsFor } from '@/features/settings/settings-sections.ts';

describe('settings sections', () => {
  it('links the workspace settings to the MCP server', () => {
    const workspace = SETTINGS_GROUPS.find((group) => group.id === 'workspace');

    expect(workspace?.sections).toContainEqual({ href: '/settings/mcp', label: 'MCP server' });
  });

  it('adds the password section when password auth is enabled', () => {
    const account = settingsGroupsFor(true).find((group) => group.id === 'account');

    expect(account?.sections).toContainEqual({
      href: '/settings/account/password',
      label: 'Password',
    });
  });

  it('omits the password section when password auth is disabled', () => {
    const account = settingsGroupsFor(false).find((group) => group.id === 'account');

    expect(account?.sections.some((section) => section.href === '/settings/account/password')).toBe(
      false,
    );
  });
});
