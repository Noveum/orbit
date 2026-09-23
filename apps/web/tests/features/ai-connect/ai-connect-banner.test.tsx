import { afterEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiConnectBanner } from '@/features/ai-connect/ai-connect-banner.tsx';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('AiConnectBanner', () => {
  it('links to the MCP settings where the clients and starter prompts live', () => {
    render(<AiConnectBanner />);
    expect(screen.getByRole('link', { name: 'Connect an AI tool' })).toHaveAttribute(
      'href',
      '/settings/mcp',
    );
  });

  it('hides itself and records the dismissal on the server', async () => {
    const request = mock(() => Promise.resolve(Response.json({ dismissed: true })));
    globalThis.fetch = request as unknown as typeof fetch;
    render(<AiConnectBanner />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('ai-connect-banner')).toBeNull();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/onboarding/ai-connect-hint',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('comes back with the error when the dismissal cannot be saved', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(Response.json({ error: { message: 'Try again' } }, { status: 500 })),
    ) as unknown as typeof fetch;
    render(<AiConnectBanner />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByTestId('ai-connect-banner')).toBeVisible();
  });
});
