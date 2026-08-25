import { describe, expect, it } from 'bun:test';
import {
  CHATGPT_CONNECTORS_URL,
  CLAUDE_CONNECTORS_URL,
  claudeCodeCommand,
  cursorInstallHref,
  mcpClients,
  vscodeInstallHref,
} from '@/features/settings/mcp-install-links.ts';

const URL_ = 'https://orbit.noveum.ai/mcp';

describe('mcp install links', () => {
  it('installs Claude Code at user scope, so every project on the machine sees it', () => {
    expect(claudeCodeCommand(URL_)).toBe(
      'claude mcp add --scope user --transport http orbit https://orbit.noveum.ai/mcp',
    );
  });

  it('encodes the Cursor deeplink config as base64 json', () => {
    const href = cursorInstallHref(URL_);
    expect(
      href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=orbit&config='),
    ).toBe(true);
    const config = href.split('config=')[1] ?? '';
    expect(JSON.parse(atob(config))).toEqual({ url: URL_ });
  });

  it('encodes the VS Code deeplink as url-encoded json', () => {
    const href = vscodeInstallHref(URL_);
    const encoded = href.replace('vscode:mcp/install?', '');
    expect(JSON.parse(decodeURIComponent(encoded))).toEqual({
      name: 'orbit',
      type: 'http',
      url: URL_,
    });
  });

  it('offers Claude and ChatGPT as connector clients, not deeplinks', () => {
    const byId = new Map(mcpClients(URL_).map((client) => [client.id, client]));

    expect(byId.get('claude')?.action).toEqual({ kind: 'open', href: CLAUDE_CONNECTORS_URL });
    expect(byId.get('chatgpt')?.action).toEqual({ kind: 'open', href: CHATGPT_CONNECTORS_URL });
    expect(CLAUDE_CONNECTORS_URL).toBe('https://claude.ai/');
    expect(CHATGPT_CONNECTORS_URL).toBe('https://chatgpt.com/');
  });

  it('uses the current Claude connector paths for individuals and organizations', () => {
    const claude = mcpClients(URL_).find((client) => client.id === 'claude');
    const steps = claude?.steps.join(' ') ?? '';

    expect(steps).toContain('Customize');
    expect(steps).toContain('Add custom connector');
    expect(steps).toContain('Organization settings');
    expect(steps).toContain('owner');
  });

  it('uses current ChatGPT Apps terms and explains the eligibility gate', () => {
    const chatgpt = mcpClients(URL_).find((client) => client.id === 'chatgpt');
    const steps = chatgpt?.steps.join(' ') ?? '';
    const businessStep = chatgpt?.steps.find((step) => step.startsWith('On Business')) ?? '';
    const enterpriseStep =
      chatgpt?.steps.find((step) => step.startsWith('On Enterprise or Edu')) ?? '';

    expect(chatgpt?.summary).toContain('eligible plans and workspace roles');
    expect(steps).toContain('developer mode');
    expect(steps).toContain('Apps');
    expect(businessStep).toContain('Workspace settings');
    expect(businessStep).toContain('Create');
    expect(businessStep).not.toContain('Advanced settings');
    expect(enterpriseStep).toContain('Advanced settings');
    expect(enterpriseStep).toContain('admin grants access');
    expect(steps).not.toContain('Add custom connector');
  });

  it('carries the server url into every client that needs it', () => {
    const byId = new Map(mcpClients(URL_).map((client) => [client.id, client]));

    expect(byId.get('claude-code')?.action).toEqual({
      kind: 'command',
      command: claudeCodeCommand(URL_),
    });
    expect(byId.get('cursor')?.action).toEqual({
      kind: 'deeplink',
      href: cursorInstallHref(URL_),
    });
    expect(byId.get('vscode')?.action).toEqual({
      kind: 'deeplink',
      href: vscodeInstallHref(URL_),
    });
  });

  it('gives other compatible clients the remote server url without assuming a config format', () => {
    const other = mcpClients(URL_).find((client) => client.id === 'other');

    expect(other?.action).toEqual({ kind: 'url', url: URL_ });
    expect(other?.summary).toContain('remote HTTP');
    expect(other?.summary).toContain('OAuth');
  });

  it('gives every client a name and at least one step', () => {
    for (const client of mcpClients(URL_)) {
      expect(client.name.length).toBeGreaterThan(0);
      expect(client.steps.length).toBeGreaterThan(0);
    }
  });
});
