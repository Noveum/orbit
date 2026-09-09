import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type AiSettingsData, AiSettingsPanel } from '@/features/settings/ai-settings-panel.tsx';

const refresh = mock();

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const INITIAL_SETTINGS: AiSettingsData = {
  configured: true,
  enabled: true,
  kind: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-3-5-sonnet-20241022',
  hasApiKey: true,
  usage: {
    totalCalls: 42,
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  },
};

const realFetch = globalThis.fetch;

let lastFetchRequest: { url: string; method: string; body: unknown } | null = null;
let fetchResponder: (url: string, method: string) => Promise<Response> = () =>
  Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));

beforeEach(() => {
  refresh.mockClear();
  lastFetchRequest = null;
  fetchResponder = () =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  globalThis.fetch = mock(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? null : (JSON.parse(init.body) as unknown);
    lastFetchRequest = { url: String(url), method, body };
    return await fetchResponder(String(url), method);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('AiSettingsPanel', () => {
  it('handles malformed test connection response schema by showing error fallback', async () => {
    const user = userEvent.setup();
    fetchResponder = () =>
      Promise.resolve(
        new Response(JSON.stringify({ malformedField: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    render(<AiSettingsPanel settings={INITIAL_SETTINGS} canManage={true} />);

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        'Connection failed: Invalid response payload from connection test.',
      );
    });
  });

  it('resets form state to default openai-compatible setup on disconnect', async () => {
    const user = userEvent.setup();
    fetchResponder = (_url, method) => {
      if (method === 'DELETE') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    render(<AiSettingsPanel settings={INITIAL_SETTINGS} canManage={true} />);

    expect((screen.getByLabelText('Provider shape') as HTMLSelectElement).value).toBe('anthropic');
    expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://api.anthropic.com',
    );
    expect((screen.getByLabelText('Model identifier') as HTMLInputElement).value).toBe(
      'claude-3-5-sonnet-20241022',
    );
    expect((screen.getByLabelText(/Enable AI capabilities/) as HTMLInputElement).checked).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(lastFetchRequest?.method).toBe('DELETE');
    });

    await waitFor(() => {
      expect((screen.getByLabelText('Provider shape') as HTMLSelectElement).value).toBe(
        'openai-compatible',
      );
      expect((screen.getByLabelText('Base URL') as HTMLInputElement).value).toBe(
        'https://api.openai.com/v1',
      );
      expect((screen.getByLabelText('Model identifier') as HTMLInputElement).value).toBe(
        'gpt-4o-mini',
      );
      expect((screen.getByLabelText(/Enable AI capabilities/) as HTMLInputElement).checked).toBe(
        false,
      );
      expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
      expect(screen.getByRole('status').textContent).toBe('AI provider disconnected.');
    });
  });
});
