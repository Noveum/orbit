export interface SettingsSection {
  readonly href: string;
  readonly label: string;
}

export interface SettingsGroup {
  readonly id: string;
  readonly title: string;
  readonly sections: readonly SettingsSection[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'account',
    title: 'Account',
    sections: [
      { href: '/settings/account', label: 'Profile' },
      { href: '/settings/account/connections', label: 'Connected accounts' },
      { href: '/settings/account/passkeys', label: 'Passkeys' },
      { href: '/settings/account/sessions', label: 'Sessions' },
    ],
  },
  {
    id: 'workspace',
    title: 'Workspace',
    sections: [
      { href: '/settings/general', label: 'General' },
      { href: '/settings/members', label: 'Members' },
      { href: '/settings/teams', label: 'Teams' },
      { href: '/settings/labels', label: 'Labels' },
      { href: '/settings/workflow', label: 'Workflow' },
      { href: '/settings/notifications', label: 'Notifications' },
      { href: '/settings/integrations', label: 'Integrations' },
      { href: '/settings/ai', label: 'AI provider' },
      { href: '/settings/mcp', label: 'MCP server' },
    ],
  },
];

const PASSWORD_SECTION: SettingsSection = {
  href: '/settings/account/password',
  label: 'Password',
};

export function settingsGroupsFor(passwordEnabled: boolean): readonly SettingsGroup[] {
  if (!passwordEnabled) return SETTINGS_GROUPS;
  return SETTINGS_GROUPS.map((group) => {
    if (group.id !== 'account') return group;
    const at = group.sections.findIndex((section) => section.href === '/settings/account/passkeys');
    const insertAt = at === -1 ? group.sections.length : at + 1;
    return {
      ...group,
      sections: [
        ...group.sections.slice(0, insertAt),
        PASSWORD_SECTION,
        ...group.sections.slice(insertAt),
      ],
    };
  });
}

export function settingsSectionsFlat(passwordEnabled: boolean): readonly SettingsSection[] {
  return settingsGroupsFor(passwordEnabled).flatMap((group) => group.sections);
}
