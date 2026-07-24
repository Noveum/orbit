import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IntegrationSettings } from './integrations-data.ts';
import { IntegrationsPanel } from './integrations-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const MCP_URL = 'https://orbit.example.com/mcp';

const CONNECTED: IntegrationSettings = {
  githubConnected: true,
  repositories: [
    {
      id: 'sync-1',
      repositoryId: '123456',
      repositoryName: 'acme/web',
      teamId: 'team-1',
      enabled: true,
    },
  ],
  slackConnected: true,
  slackHasToken: true,
  channels: [{ channelId: 'C0123', channelName: 'engineering', teamId: 'team-1', enabled: true }],
  teams: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
};

const EMPTY: IntegrationSettings = {
  githubConnected: false,
  repositories: [],
  slackConnected: false,
  slackHasToken: false,
  channels: [],
  teams: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }],
};

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
  it('lists linked repositories with their team and an unlink action', () => {
    render(<IntegrationsPanel settings={CONNECTED} canManage mcpUrl={MCP_URL} />);
    expect(screen.getByText('acme/web')).toBeInTheDocument();
    expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeEnabled();
  });

  it('links a repository through the github endpoint', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPanel settings={EMPTY} canManage mcpUrl={MCP_URL} />);

    await user.type(screen.getByLabelText('Repository'), 'acme/api');
    await user.type(screen.getByLabelText('Repository id'), '99');
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    await waitFor(() => {
      expect(lastRequest?.url).toBe('/api/integrations/github');
    });
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.body).toEqual({
      repositoryId: '99',
      repositoryName: 'acme/api',
      teamId: 'team-1',
    });
  });

  it('unlinks a repository through the github endpoint', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPanel settings={CONNECTED} canManage mcpUrl={MCP_URL} />);

    await user.click(screen.getByRole('button', { name: 'Unlink' }));

    await waitFor(() => {
      expect(lastRequest?.method).toBe('DELETE');
    });
    expect(lastRequest?.url).toBe('/api/integrations/github?repositoryId=123456');
  });

  it('shows the MCP server URL and copies it to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<IntegrationsPanel settings={CONNECTED} canManage mcpUrl={MCP_URL} />);

    expect(screen.getByTestId('mcp-url')).toHaveTextContent(MCP_URL);
    await user.click(screen.getByRole('button', { name: 'Copy MCP server URL' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(MCP_URL);
    });
  });

  it('hides management affordances when the viewer cannot manage integrations', () => {
    render(<IntegrationsPanel settings={CONNECTED} canManage={false} mcpUrl={MCP_URL} />);
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(screen.queryByLabelText('Repository')).toBeNull();
    expect(screen.getByTestId('mcp-url')).toBeInTheDocument();
  });
});
