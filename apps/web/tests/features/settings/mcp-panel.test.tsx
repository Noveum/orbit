import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CHATGPT_CONNECTORS_URL,
  CLAUDE_CONNECTORS_URL,
} from '../../../src/features/settings/mcp-install-links.ts';
import { type McpConnection, McpPanel } from '../../../src/features/settings/mcp-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const MCP_URL = 'https://orbit.example.com/mcp';

const CONNECTED: readonly McpConnection[] = [
  {
    id: 'grant-1',
    clientName: 'Claude',
    organizationName: 'Noveum AI',
    lastUsedAt: '2026-08-24T10:00:00.000Z',
  },
];

const realFetch = globalThis.fetch;
const realOpen = globalThis.window.open;
const realClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');

let lastRequest: { url: string; method: string } | null = null;
let opened: string[] = [];
let clipboard: string[] = [];

beforeEach(() => {
  refresh.mockClear();
  lastRequest = null;
  opened = [];
  clipboard = [];

  globalThis.fetch = mock((url: string, init?: { method?: string }) => {
    lastRequest = { url, method: init?.method ?? 'GET' };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;

  globalThis.window.open = mock((url?: string | URL) => {
    opened.push(String(url));
    return null;
  }) as unknown as typeof window.open;

  installClipboard();
});

function installClipboard(): void {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (value: string) => {
        clipboard.push(value);
        return Promise.resolve();
      },
    },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.window.open = realOpen;
  if (realClipboard === undefined) {
    Reflect.deleteProperty(globalThis.navigator, 'clipboard');
  } else {
    Object.defineProperty(globalThis.navigator, 'clipboard', realClipboard);
  }
});

describe('McpPanel', () => {
  it('shows the server url so any client can be pointed at it', () => {
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    expect(screen.getByTestId('mcp-url').textContent).toBe(MCP_URL);
  });

  it('offers every supported client', () => {
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    for (const id of ['claude', 'chatgpt', 'claude-code', 'cursor', 'vscode', 'other']) {
      expect(screen.getByTestId(`mcp-client-${id}`)).toBeDefined();
    }
  });

  it('copies the url and opens the connector page for Claude', async () => {
    const user = userEvent.setup();
    installClipboard();
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    await user.click(screen.getByRole('button', { name: /open Claude$/i }));

    await waitFor(() => expect(clipboard).toEqual([MCP_URL]));
    expect(opened[0]).toBe(CLAUDE_CONNECTORS_URL);
  });

  it('copies the url and opens the connector page for ChatGPT', async () => {
    const user = userEvent.setup();
    installClipboard();
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    await user.click(screen.getByRole('button', { name: /open ChatGPT$/i }));

    await waitFor(() => expect(clipboard).toEqual([MCP_URL]));
    expect(opened[0]).toBe(CHATGPT_CONNECTORS_URL);
  });

  it('links Cursor and VS Code straight at their install deeplinks', () => {
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    const cursor = screen.getByTestId('mcp-client-cursor').querySelector('a');
    const vscode = screen.getByTestId('mcp-client-vscode').querySelector('a');

    expect(cursor?.getAttribute('href')?.startsWith('cursor://')).toBe(true);
    expect(vscode?.getAttribute('href')?.startsWith('vscode:mcp/install?')).toBe(true);
  });

  it('offers a pasteable config for a client with no shortcut of its own', () => {
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    const block = screen.getByTestId('mcp-client-other').querySelector('code');
    expect(JSON.parse(block?.textContent ?? '{}')).toEqual({
      mcpServers: { orbit: { type: 'http', url: MCP_URL } },
    });
  });

  it('says so when nothing is connected yet', () => {
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    expect(screen.getByText('No clients connected yet.')).toBeDefined();
  });

  it('disconnects a connected client through the grant api', async () => {
    const user = userEvent.setup();
    render(<McpPanel mcpUrl={MCP_URL} connections={CONNECTED} />);

    await user.click(screen.getByRole('button', { name: 'Disconnect Claude' }));

    await waitFor(() => expect(lastRequest).not.toBeNull());
    expect(lastRequest?.method).toBe('DELETE');
    expect(lastRequest?.url).toContain('grantId=grant-1');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
