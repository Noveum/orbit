import { describe, expect, it } from 'bun:test';
import { integrationProvider } from '@/features/settings/integration-provider.ts';

describe('integration provider selection', () => {
  it('defaults unknown or missing selections to GitHub', () => {
    expect(integrationProvider(undefined, true)).toBe('github');
    expect(integrationProvider('unknown', true)).toBe('github');
    expect(integrationProvider(['slack', 'mcp'], true)).toBe('github');
  });

  it('selects Slack even before its runtime is enabled', () => {
    expect(integrationProvider('slack', true)).toBe('slack');
    expect(integrationProvider('mcp', true)).toBe('mcp');
  });

  it('keeps non-admins on MCP regardless of the requested provider', () => {
    expect(integrationProvider('github', false)).toBe('mcp');
    expect(integrationProvider('slack', false)).toBe('mcp');
  });
});
