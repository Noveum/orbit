import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { claudePromptHref, starterPrompt } from '@/features/ai-connect/starter-prompts.ts';
import { ConnectStep } from '@/features/onboarding/steps/connect-step.tsx';
import { claudeCodeCommand } from '@/features/settings/mcp-install-links.ts';

const MCP_URL = 'https://orbit.example/mcp';
const realFetch = globalThis.fetch;
const realClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
let clipboard: string[] = [];
let connections: { id: string; clientName: string; organizationName: string }[] = [];
let patchResponse: Response = Response.json({ onboarding: { completed: false, step: 'theme' } });
const requests: { url: string; method: string; body: string | undefined }[] = [];

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

beforeEach(() => {
  clipboard = [];
  connections = [];
  requests.length = 0;
  patchResponse = Response.json({ onboarding: { completed: false, step: 'theme' } });
  installClipboard();
  globalThis.fetch = mock((url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body });
    if (url === '/api/integrations/mcp') return Promise.resolve(Response.json({ connections }));
    return Promise.resolve(patchResponse);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realClipboard === undefined) {
    Reflect.deleteProperty(globalThis.navigator, 'clipboard');
  } else {
    Object.defineProperty(globalThis.navigator, 'clipboard', realClipboard);
  }
});

describe('onboarding connect step', () => {
  it('always shows the MCP server URL, whichever AI tool is picked', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    expect(screen.getByTestId('onboarding-mcp-url')).toHaveTextContent(MCP_URL);
    await userEvent.setup().click(screen.getByLabelText('Cursor'));
    expect(screen.getByTestId('onboarding-mcp-url')).toHaveTextContent(MCP_URL);
  });

  it('shows the setup for the AI tool the user picks', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    expect(screen.getByTestId('mcp-client-claude')).toBeVisible();
    await userEvent.setup().click(screen.getByLabelText('Claude Code'));
    expect(screen.queryByTestId('mcp-client-claude')).toBeNull();
    expect(screen.getByTestId('mcp-client-claude-code')).toHaveTextContent(
      claudeCodeCommand(MCP_URL),
    );
  });

  it('waits for a connection, then confirms it and stops offering to continue without one', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    expect(await screen.findByText(/Waiting for your AI tool/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue without connecting' })).toBeVisible();
    approveConnectionElsewhere({ id: 'g1', clientName: 'Claude', organizationName: 'Acme' });
    expect(await screen.findByText(/Connected: Claude\./)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue without connecting' })).toBeNull();
  });

  it('offers to open Claude with the prompt filled in only when Claude can run it', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    const user = userEvent.setup();
    expect(screen.getByRole('link', { name: 'Open in Claude' })).toHaveAttribute(
      'href',
      claudePromptHref(starterPrompt('import', 'linear')),
    );
    expect(screen.getByText(/Paste it into Claude\./)).toBeVisible();
    await user.click(screen.getByLabelText(/Backlog from my code/));
    expect(screen.queryByRole('link', { name: 'Open in Claude' })).toBeNull();
    expect(screen.getByText(/Run this in a coding agent/)).toBeVisible();
    await user.click(screen.getByLabelText(/Plan something new/));
    await user.click(screen.getByLabelText('Cursor'));
    expect(screen.queryByRole('link', { name: 'Open in Claude' })).toBeNull();
    expect(screen.getByText(/Paste it into Cursor\./)).toBeVisible();
  });

  it('copies the starter prompt the user chose', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    const user = userEvent.setup();
    installClipboard();
    expect(screen.getByTestId('starter-prompt-text')).toHaveTextContent('from Linear');
    await user.click(screen.getByLabelText(/Plan something new/));
    await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
    await waitFor(() => expect(clipboard).toEqual([starterPrompt('plan')]));
  });

  it('copies the prompt for the tool the user is moving from', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    const user = userEvent.setup();
    installClipboard();
    await user.click(screen.getByRole('combobox', { name: 'Tool you use today' }));
    await user.click(screen.getByRole('option', { name: 'Trello' }));
    expect(screen.getByTestId('starter-prompt-text')).toHaveTextContent('from Trello');
    await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(clipboard).toEqual([starterPrompt('import', 'trello')]));
  });

  it('advances the connect step when the user continues without connecting', async () => {
    const onNext = mock();
    render(<ConnectStep mcpUrl={MCP_URL} onNext={onNext} />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Continue without connecting' }));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith({ completed: false, step: 'theme' }));
    expect(requests).toContainEqual({
      url: '/api/onboarding',
      method: 'PATCH',
      body: JSON.stringify({ step: 'connect' }),
    });
  });

  it('keeps the user on the step and shows the error when saving fails', async () => {
    patchResponse = Response.json({ error: { message: 'Try again' } }, { status: 500 });
    const onNext = mock();
    render(<ConnectStep mcpUrl={MCP_URL} onNext={onNext} />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Continue without connecting' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue without connecting' })).toBeEnabled();
  });
});

function approveConnectionElsewhere(connection: {
  id: string;
  clientName: string;
  organizationName: string;
}): void {
  connections = [connection];
  window.dispatchEvent(new Event('focus'));
}
