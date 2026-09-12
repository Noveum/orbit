import { describe, expect, it } from 'bun:test';
import {
  SETTINGS_GROUPS,
  settingsGroupsFor,
  settingsSectionsFlat,
} from '@/features/settings/settings-sections.ts';

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

  it('lists every section in sidebar order for keyboard navigation', () => {
    expect(settingsSectionsFlat(false).map((section) => section.label)).toEqual([
      'Profile',
      'Connected accounts',
      'Passkeys',
      'Sessions',
      'General',
      'Members',
      'Teams',
      'Labels',
      'Workflow',
      'Notifications',
      'Integrations',
      'MCP server',
    ]);
  });

  it('inserts password in sidebar order when password auth is enabled', () => {
    expect(settingsSectionsFlat(true).map((section) => section.label)).toEqual([
      'Profile',
      'Connected accounts',
      'Passkeys',
      'Password',
      'Sessions',
      'General',
      'Members',
      'Teams',
      'Labels',
      'Workflow',
      'Notifications',
      'Integrations',
      'MCP server',
    ]);
  });
});
