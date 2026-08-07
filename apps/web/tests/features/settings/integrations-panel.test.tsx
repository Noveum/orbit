import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { IntegrationSettings } from '../../../src/features/settings/integrations-data.ts';
import {
  IntegrationsPanel,
  type McpConnection,
} from '../../../src/features/settings/integrations-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const MCP_URL = 'https://orbit.example.com/mcp';

const CONNECTED: IntegrationSettings = {
  github: {
    connected: true,
    connectEnabled: true,
    discoveryEnabled: true,
    installations: [
      {
        installationId: '151887625',
        accountLogin: 'Noveum',
        accountType: 'Organization',
        repositorySelection: 'all',
        status: 'active',
        repositoryCount: 1,
        manageUrl: 'https://github.com/organizations/Noveum/settings/installations/151887625',
      },
    ],
    repositories: [
      {
        id: 'repo-row-1',
        repositoryId: '123456',
        fullName: 'Noveum/web',
        name: 'web',
        ownerLogin: 'Noveum',
        private: false,
        archived: false,
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/Noveum/web',
        installationId: '151887625',
        accountLogin: 'Noveum',
        links: [],
      },
    ],
    projects: [{ id: 'project-1', name: 'Apollo' }],
  },
  slackConnected: true,
  slackHasToken: true,
  slackConnectEnabled: true,
  channels: [{ channelId: 'C0123', channelName: 'engineering', teamId: 'team-1', enabled: true }],
  teams: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
};

const EMPTY: IntegrationSettings = {
  github: {
    connected: false,
    connectEnabled: true,
    discoveryEnabled: true,
    installations: [],
    repositories: [],
    projects: [],
  },
  slackConnected: false,
  slackHasToken: false,
  slackConnectEnabled: true,
  channels: [],
  teams: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
};

const UNCONFIGURED: IntegrationSettings = {
  ...EMPTY,
  github: { ...EMPTY.github, connectEnabled: false },
  slackConnectEnabled: false,
};

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPanel(
  settings: IntegrationSettings,
  canManage: boolean,
  mcpConnections: readonly McpConnection[] = [],
) {
  return render(
    <Providers>
      <IntegrationsPanel
        settings={settings}
        canManage={canManage}
        mcpUrl={MCP_URL}
        mcpConnections={mcpConnections}
      />
    </Providers>,
  );
}

const realFetch = globalThis.fetch;
let lastRequest: { url: string; method: string; body: unknown } | null = null;

beforeEach(() => {
  refresh.mockClear();
  lastRequest = null;
  globalThis.fetch = mock((url: string, init?: { method?: string; body?: string }) => {
    lastRequest = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('IntegrationsPanel', () => {
  it('offers one-click connect actions as the primary path when nothing is connected', () => {
    renderPanel(EMPTY, true);
    const github = screen.getByRole('link', { name: 'Connect GitHub' });
    expect(github).toHaveAttribute('href', '/api/integrations/github/start');
    const slack = screen.getByRole('link', { name: 'Add to Slack' });
    expect(slack).toHaveAttribute('href', '/api/integrations/slack/start');
  });

  it('never exposes a webhook secret or raw token entry', () => {
    renderPanel(EMPTY, true);
    expect(screen.queryByText(/GITHUB_WEBHOOK_SECRET/)).toBeNull();
    expect(screen.queryByLabelText('Bot token')).toBeNull();
    expect(screen.queryByLabelText('Repository id')).toBeNull();
  });

  it('hides connect actions and explains configuration is pending when the app is not set up', () => {
    renderPanel(UNCONFIGURED, true);
    expect(screen.queryByRole('link', { name: 'Connect GitHub' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Add to Slack' })).toBeNull();
    expect(screen.getByText(/finish configuring the GitHub App/)).toBeInTheDocument();
  });

  it('opens a searchable channel picker to connect a channel', async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED, true);
    await user.click(screen.getByRole('button', { name: 'Connect a channel' }));
    expect(await screen.findByPlaceholderText('Search channels…')).toBeInTheDocument();
  });

  it('disconnects a connected Slack channel through the slack endpoint', async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED, true);

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(lastRequest?.url).toBe('/api/integrations/slack');
    });
    expect(lastRequest?.body).toEqual({ action: 'disconnect', channelId: 'C0123' });
  });

  it('shows the MCP server URL and copies it to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderPanel(CONNECTED, true);

    expect(screen.getByTestId('mcp-url')).toHaveTextContent(MCP_URL);
    await user.click(screen.getByRole('button', { name: 'Copy MCP server URL' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(MCP_URL);
    });
  });

  it('hides management affordances when the viewer cannot manage integrations', () => {
    renderPanel(CONNECTED, false);
    expect(screen.queryByRole('button', { name: 'Connect a channel' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Connect another organisation' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove the/ })).toBeNull();
    expect(screen.getByTestId('mcp-url')).toBeInTheDocument();
  });

  it('renders no repository or channel name to a viewer who cannot manage integrations', () => {
    renderPanel(CONNECTED, false);

    expect(screen.queryByText('Noveum/web')).toBeNull();
    expect(screen.queryByText('#engineering')).toBeNull();
    expect(screen.getByTestId('integrations-withheld')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-url')).toBeInTheDocument();
  });

  it('offers a one-click Claude Code command and drops the admin API key copy', () => {
    renderPanel(CONNECTED, true);
    expect(
      screen.getByRole('button', { name: 'Copy the Claude Code command' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No API key needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/issued by an admin/i)).toBeNull();
  });

  it('lists connected clients and disconnects one through the mcp endpoint', async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED, true, [
      {
        id: 'grant-1',
        clientName: 'Claude Desktop',
        organizationName: 'Nova',
        lastUsedAt: null,
      },
    ]);

    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect Claude Desktop' }));

    await waitFor(() => {
      expect(lastRequest?.method).toBe('DELETE');
    });
    expect(lastRequest?.url).toBe('/api/integrations/mcp?grantId=grant-1');
  });
});
