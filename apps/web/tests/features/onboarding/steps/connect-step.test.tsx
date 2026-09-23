import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { starterPrompt } from '@/features/ai-connect/starter-prompts.ts';
import { ConnectStep } from '@/features/onboarding/steps/connect-step.tsx';
import { claudeCodeCommand } from '@/features/settings/mcp-install-links.ts';

const MCP_URL = 'https://orbit.example/mcp';
const realFetch = globalThis.fetch;
const realClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
let clipboard: string[] = [];

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
  installClipboard();
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
  it('shows the setup for the AI tool the user picks', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    expect(screen.getByTestId('mcp-client-claude')).toBeVisible();
    await userEvent.setup().click(screen.getByLabelText('Claude Code'));
    expect(screen.queryByTestId('mcp-client-claude')).toBeNull();
    expect(screen.getByTestId('mcp-client-claude-code')).toHaveTextContent(
      claudeCodeCommand(MCP_URL),
    );
  });

  it('copies the starter prompt the user chose', async () => {
    render(<ConnectStep mcpUrl={MCP_URL} onNext={mock()} />);
    const user = userEvent.setup();
    installClipboard();
    expect(screen.getByTestId('starter-prompt-text')).toHaveTextContent('from Linear');
    await user.click(screen.getByLabelText(/Plan something new/));
    await user.click(screen.getByRole('button', { name: 'Copy starter prompt' }));
    await waitFor(() => expect(clipboard).toEqual([starterPrompt('plan')]));
  });

  it('advances the connect step when the user skips it', async () => {
    const onboarding = { completed: false, step: 'theme' };
    const request = mock(() => Promise.resolve(Response.json({ onboarding })));
    globalThis.fetch = request as unknown as typeof fetch;
    const onNext = mock();
    render(<ConnectStep mcpUrl={MCP_URL} onNext={onNext} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(onboarding));
    expect(request).toHaveBeenCalledWith(
      '/api/onboarding',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ step: 'connect' }) }),
    );
  });

  it('keeps the user on the step and shows the error when saving fails', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ error: { message: 'Try again' } }, { status: 500 })),
    ) as unknown as typeof fetch;
    const onNext = mock();
    render(<ConnectStep mcpUrl={MCP_URL} onNext={onNext} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
