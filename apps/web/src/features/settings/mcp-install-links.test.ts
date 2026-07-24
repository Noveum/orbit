import { describe, expect, it } from 'bun:test';
import {
  claudeCodeCommand,
  cursorInstallHref,
  mcpClientConfigJson,
  vscodeInstallHref,
} from './mcp-install-links.ts';

const URL_ = 'https://orbit.noveum.ai/mcp';

describe('mcp install links', () => {
  it('builds the Claude Code command', () => {
    expect(claudeCodeCommand(URL_)).toBe(
      'claude mcp add --transport http orbit https://orbit.noveum.ai/mcp',
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
});
