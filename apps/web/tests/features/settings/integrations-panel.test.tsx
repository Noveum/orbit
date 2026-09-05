import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { IntegrationSettings } from '@/features/settings/integrations-data.ts';
import { IntegrationsPanel } from '@/features/settings/integrations-panel.tsx';
import type { McpConnection } from '@/features/settings/mcp-panel.tsx';

const refresh = mock();
const replace = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
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
};

const CONNECTED_WITH_SLACK: IntegrationSettings = {
  ...CONNECTED,
  slack: {
    slackConnected: false,
    slackHasToken: false,
    slackConnectEnabled: true,
    channels: [],
    teams: [],
    memberSync: { eligible: 3, mapped: 0, ready: false },
  },
};

const CONNECTED_WITH_SLACK_TOKEN: IntegrationSettings = {
  ...CONNECTED,
  slack: {
    slackConnected: true,
    slackHasToken: true,
    slackConnectEnabled: true,
    channels: [],
    teams: [{ id: 'team-engineering', name: 'Engineering', key: 'ENG' }],
    memberSync: { eligible: 2, mapped: 1, ready: true },
  },
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
};

const UNCONFIGURED: IntegrationSettings = {
  ...EMPTY,
  github: { ...EMPTY.github, connectEnabled: false },
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
  replace.mockClear();
  lastRequest = null;
  globalThis.fetch = mock((url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body === undefined ? undefined : JSON.parse(init.body);
    lastRequest = {
      url,
      method: init?.method ?? 'GET',
      body,
    };
    let payload: unknown = {};
    if (url.startsWith('/api/integrations/slack/channels')) {
      payload = {
        channels: [{ channelId: 'C-CANONICAL', channelName: 'canonical-name' }],
        nextCursor: null,
      };
    } else if (body?.action === 'sync_members') {
      payload = { eligible: 2, mapped: 2 };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('IntegrationsPanel', () => {
  it('renders Slack when the server includes Slack settings', () => {
    renderPanel(CONNECTED_WITH_SLACK, true);

    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add to Slack' })).toHaveAttribute(
      'href',
      '/api/integrations/slack/start',
    );
    expect(screen.queryByRole('button', { name: 'Sync Slack members' })).toBeNull();
  });

  it('does not render Slack when the server withholds Slack settings', () => {
    renderPanel(CONNECTED, true);

    expect(screen.queryByText(/slack/i)).toBeNull();
    expect(document.querySelector('a[href*="slack"]')).toBeNull();
  });

  it('connects a Slack channel with its id and Orbit team only', async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED_WITH_SLACK_TOKEN, true);

    await user.click(screen.getByRole('button', { name: 'Connect a channel' }));
    await user.click(await screen.findByRole('button', { name: '#canonical-name' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Team' }), 'team-engineering');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => {
      expect(lastRequest?.method).toBe('POST');
    });
    expect(lastRequest).toEqual({
      url: '/api/integrations/slack',
      method: 'POST',
      body: {
        action: 'connect',
        channelId: 'C-CANONICAL',
        teamId: 'team-engineering',
      },
    });
  });

  it('shows member coverage and synchronizes the existing Slack connection', async () => {
    const user = userEvent.setup();
    renderPanel(CONNECTED_WITH_SLACK_TOKEN, true);

    expect(screen.getByText('1 of 2 workspace members matched by email.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sync Slack members' }));

    await waitFor(() => {
      expect(lastRequest).toEqual({
        url: '/api/integrations/slack',
        method: 'POST',
        body: { action: 'sync_members' },
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Slack member sync completed: 2 of 2 matched.',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/settings/integrations', { scroll: false });
  });

  it('marks the member sync control aria-disabled while Slack is still responding', async () => {
    let finish: (() => void) | undefined;
    globalThis.fetch = mock(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(Response.json({ eligible: 2, mapped: 2 }));
        }),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    renderPanel(CONNECTED_WITH_SLACK_TOKEN, true);

    await user.click(screen.getByRole('button', { name: 'Sync Slack members' }));

    const pendingSync = screen.getByRole('button', { name: 'Syncing Slack members' });
    expect(pendingSync).toHaveAttribute('aria-disabled', 'true');
    expect(pendingSync).not.toBeDisabled();
    expect(pendingSync).toHaveFocus();
    finish?.();
    await screen.findByText('Slack member sync completed: 2 of 2 matched.');
  });

  it('re-enables member sync and reports a provider failure without refreshing', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json(
          { error: { code: 'internal', message: 'Slack directory unavailable.' } },
          { status: 500 },
        ),
      ),
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    renderPanel(CONNECTED_WITH_SLACK_TOKEN, true);

    await user.click(screen.getByRole('button', { name: 'Sync Slack members' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Slack directory unavailable.');
    expect(screen.getByRole('button', { name: 'Sync Slack members' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks for reconnection instead of offering a member sync that cannot succeed', () => {
    const slackSettings = CONNECTED_WITH_SLACK_TOKEN.slack;
    if (slackSettings === undefined) throw new Error('Expected Slack settings.');
    renderPanel(
      {
        ...CONNECTED_WITH_SLACK_TOKEN,
        slack: {
          ...slackSettings,
          memberSync: { eligible: 2, mapped: 1, ready: false },
        },
      },
      true,
    );

    expect(
      screen.getByText('Reconnect Slack to enable workspace member sync.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync Slack members' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Reconnect Slack' })).toBeInTheDocument();
  });

  it('offers GitHub connect as the primary path when nothing is connected', () => {
    renderPanel(EMPTY, true);
    const github = screen.getByRole('link', { name: 'Connect GitHub' });
    expect(github).toHaveAttribute('href', '/api/integrations/github/start');
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
    expect(screen.getByText(/finish configuring the GitHub App/)).toBeInTheDocument();
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
    renderPanel(CONNECTED_WITH_SLACK_TOKEN, false);
    expect(screen.queryByRole('link', { name: 'Connect another organisation' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove the/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sync Slack members' })).toBeNull();
    expect(screen.queryByText('1 of 2 workspace members matched by email.')).toBeNull();
    expect(screen.getByText('Workspace integrations')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-url')).toBeInTheDocument();
  });

  it('renders no repository name to a viewer who cannot manage integrations', () => {
    renderPanel(CONNECTED, false);

    expect(screen.queryByText('Noveum/web')).toBeNull();
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
