import { describe, expect, it } from 'bun:test';
import {
  CHATGPT_CONNECTORS_URL,
  CLAUDE_CONNECTORS_URL,
  claudeCodeCommand,
  cursorInstallHref,
  mcpClientConfigJson,
  mcpClients,
  vscodeInstallHref,
} from '../../../src/features/settings/mcp-install-links.ts';

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

  it('builds a client config without any api key', () => {
    const json = mcpClientConfigJson(URL_);
    expect(JSON.parse(json)).toEqual({ mcpServers: { orbit: { type: 'http', url: URL_ } } });
    expect(json).not.toContain('Authorization');
  });

  it('offers Claude and ChatGPT as connector clients, not deeplinks', () => {
    const byId = new Map(mcpClients(URL_).map((client) => [client.id, client]));

    expect(byId.get('claude')?.action).toEqual({ kind: 'open', href: CLAUDE_CONNECTORS_URL });
    expect(byId.get('chatgpt')?.action).toEqual({ kind: 'open', href: CHATGPT_CONNECTORS_URL });
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

  it('falls back to a pasteable config for any client without a shortcut', () => {
    const other = mcpClients(URL_).find((client) => client.id === 'other');

    expect(other?.action).toEqual({ kind: 'config', json: mcpClientConfigJson(URL_) });
  });

  it('gives every client a name and at least one step', () => {
    for (const client of mcpClients(URL_)) {
      expect(client.name.length).toBeGreaterThan(0);
      expect(client.steps.length).toBeGreaterThan(0);
    }
  });
});
