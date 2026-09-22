import { describe, expect, it } from 'bun:test';
import { integrationProvider } from '@/features/settings/integration-provider.ts';

describe('integration provider selection', () => {
  it('defaults unknown or missing selections to GitHub', () => {
    expect(integrationProvider(undefined, true, true)).toBe('github');
    expect(integrationProvider('unknown', true, true)).toBe('github');
    expect(integrationProvider(['slack', 'mcp'], true, true)).toBe('github');
  });

  it('selects available providers and falls back when Slack is withheld', () => {
    expect(integrationProvider('slack', true, true)).toBe('slack');
    expect(integrationProvider('slack', true, false)).toBe('github');
    expect(integrationProvider('mcp', true, true)).toBe('mcp');
  });

  it('keeps non-admins on MCP regardless of the requested provider', () => {
    expect(integrationProvider('github', false, true)).toBe('mcp');
    expect(integrationProvider('slack', false, true)).toBe('mcp');
  });
});
