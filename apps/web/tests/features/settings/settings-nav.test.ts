import { describe, expect, it } from 'bun:test';
import { SETTINGS_GROUPS } from '@/features/settings/settings-nav.tsx';

describe('SettingsNav', () => {
  it('links the workspace settings to the MCP server', () => {
    const workspace = SETTINGS_GROUPS.find((group) => group.id === 'workspace');

    expect(workspace?.sections).toContainEqual({ href: '/settings/mcp', label: 'MCP server' });
  });
});
