import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AgentSettingsView } from '@orbit/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CHATGPT_CONNECTORS_URL,
  CLAUDE_CONNECTORS_URL,
} from '@/features/settings/mcp-install-links.ts';
import { type McpConnection, McpPanel } from '@/features/settings/mcp-panel.tsx';

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

const AGENT: AgentSettingsView = {
  id: 'agent-1',
  name: 'Researcher',
  avatar: null,
  lifecycle: 'active',
  connection: 'connected',
  owner: { id: 'owner-1', name: 'Ari', avatar: null },
  client: { id: 'client-1', name: 'Claude' },
  grant: { id: 'grant-1', scopes: ['orbit.read', 'orbit.write'] },
  effectivePermissions: ['issue:read', 'issue:create'],
  ownerLocked: false,
  adminLocked: false,
  lastUsedAt: null,
  lastActedAt: null,
  openIssueCount: 2,
  recentActivity: [],
  viewerAuthority: 'owner',
};

const realFetch = globalThis.fetch;
const realOpen = globalThis.window.open;
const realClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');

let lastRequest: { url: string; method: string; body: string | null } | null = null;
let opened: string[] = [];
let clipboard: string[] = [];

beforeEach(() => {
  refresh.mockClear();
  lastRequest = null;
  opened = [];
  clipboard = [];

  globalThis.fetch = mock((url: string, init?: { method?: string; body?: string }) => {
    lastRequest = { url, method: init?.method ?? 'GET', body: init?.body ?? null };
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
  it('shows the server url for compatible clients', () => {
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

  it('offers compatible remote clients the url without promising a config shape', async () => {
    const user = userEvent.setup();
    installClipboard();
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    const tile = screen.getByTestId('mcp-client-other');
    expect(tile.textContent).toContain('remote HTTP');
    expect(tile.textContent).toContain('OAuth');
    expect(tile.querySelector('code')?.textContent).toBe(MCP_URL);
    expect(tile.textContent).not.toContain('mcpServers');

    await user.click(
      screen.getByRole('button', { name: 'Copy the Orbit server URL for Other remote clients' }),
    );
    await waitFor(() => expect(clipboard).toEqual([MCP_URL]));
  });

  it('says so when nothing is connected yet', () => {
    render(<McpPanel mcpUrl={MCP_URL} connections={[]} />);

    expect(screen.getByText('No clients connected yet.')).toBeDefined();
  });

  it('marks an unbound legacy connection as requiring renewed consent', () => {
    const connected = CONNECTED[0];
    if (connected === undefined) throw new Error('Missing connection fixture.');
    render(<McpPanel mcpUrl={MCP_URL} connections={[{ ...connected, agentIdentityId: null }]} />);
    expect(
      screen.getByText('Action required: reconnect and choose an agent identity.'),
    ).toBeDefined();
  });

  it('shows separate agent states and lets its owner update the name', async () => {
    const user = userEvent.setup();
    render(
      <McpPanel
        mcpUrl={MCP_URL}
        connections={CONNECTED}
        agents={{
          yourAgents: [AGENT],
          workspaceAgents: [],
          activeQuotaUsed: 1,
          activeQuotaLimit: 2,
        }}
      />,
    );
    const card = screen.getByTestId('mcp-agent-agent-1');
    expect(card.textContent).toContain('Lifecycle: active. Connection: connected.');
    expect(card.textContent).toContain('Granted scopes: orbit.read, orbit.write.');
    await user.clear(screen.getByRole('textbox', { name: 'Name for Researcher' }));
    await user.type(screen.getByRole('textbox', { name: 'Name for Researcher' }), 'Planner');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(lastRequest?.method).toBe('PATCH'));
    expect(lastRequest?.url).toContain('/api/integrations/mcp/agents/agent-1');
    expect(JSON.parse(lastRequest?.body ?? '{}')).toEqual({
      action: 'update_profile',
      profile: { name: 'Planner', avatar: null },
    });
  });

  it('shows workspace agents to an admin without offering owner profile changes', () => {
    render(
      <McpPanel
        mcpUrl={MCP_URL}
        connections={[]}
        agents={{
          yourAgents: [],
          workspaceAgents: [{ ...AGENT, viewerAuthority: 'admin' }],
          activeQuotaUsed: 0,
          activeQuotaLimit: 2,
        }}
      />,
    );
    expect(screen.getByTestId('mcp-agent-agent-1')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
  });

  it('uses only an Orbit uploaded owner avatar for profile changes', async () => {
    const user = userEvent.setup();
    render(
      <McpPanel
        mcpUrl={MCP_URL}
        connections={[]}
        agents={{
          yourAgents: [
            { ...AGENT, owner: { ...AGENT.owner, avatar: '/api/avatars/avatar-1?v=1' } },
          ],
          workspaceAgents: [],
          activeQuotaUsed: 1,
          activeQuotaLimit: 2,
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Use profile avatar' }));
    await waitFor(() => expect(lastRequest?.method).toBe('PATCH'));
    expect(JSON.parse(lastRequest?.body ?? '{}')).toEqual({
      action: 'update_profile',
      profile: { name: 'Researcher', avatar: '/api/avatars/avatar-1?v=1' },
    });
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
