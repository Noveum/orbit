import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiConnectBanner } from '@/features/ai-connect/ai-connect-banner.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  refresh.mockClear();
});

describe('AiConnectBanner', () => {
  it('links to the MCP settings where the clients and starter prompts live', () => {
    render(<AiConnectBanner mcpUrl="https://orbit.example/mcp" />);
    expect(screen.getByRole('link', { name: 'Connect an AI tool' })).toHaveAttribute(
      'href',
      '/settings/mcp',
    );
  });

  it('always shows the MCP server URL', () => {
    render(<AiConnectBanner mcpUrl="https://orbit.example/mcp" />);
    expect(screen.getByTestId('ai-connect-banner-url')).toHaveTextContent(
      'https://orbit.example/mcp',
    );
  });

  it('hides itself and records the dismissal on the server', async () => {
    const request = mock(() => Promise.resolve(Response.json({ dismissed: true })));
    globalThis.fetch = request as unknown as typeof fetch;
    render(<AiConnectBanner mcpUrl="https://orbit.example/mcp" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('ai-connect-banner')).toBeNull();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/onboarding/ai-connect-hint',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('comes back with the error when the dismissal cannot be saved', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ error: { message: 'Try again' } }, { status: 500 })),
    ) as unknown as typeof fetch;
    render(<AiConnectBanner mcpUrl="https://orbit.example/mcp" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByTestId('ai-connect-banner')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });
});
