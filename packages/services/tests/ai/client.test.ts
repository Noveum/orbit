import { afterEach, describe, expect, it } from 'bun:test';
import { AiClientError, AiDisabledError, complete } from '../../src/ai/client.ts';

const originalFetch = globalThis.fetch;

describe('AI client complete()', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('completes prompt against OpenAI-compatible endpoint', async () => {
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody = '';

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedAuth = String((init?.headers as Record<string, string>)?.['authorization']);
      capturedBody = String(init?.body);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Hello from OpenAI model!' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await complete('Say hello', {
      config: {
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        enabled: true,
      },
      apiKey: 'sk-mock-openai-key',
      recordUsage: false,
    });

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect(capturedAuth).toBe('Bearer sk-mock-openai-key');
    expect(capturedBody).toContain('"messages":[{"role":"user","content":"Say hello"}]');
    expect(result.text).toBe('Hello from OpenAI model!');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('completes prompt against Anthropic native endpoint', async () => {
    let capturedUrl = '';
    let capturedApiKey = '';
    let capturedVersion = '';

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedApiKey = String((init?.headers as Record<string, string>)?.['x-api-key']);
      capturedVersion = String((init?.headers as Record<string, string>)?.['anthropic-version']);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'Hello from Claude model!' }],
            usage: { input_tokens: 12, output_tokens: 6 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const result = await complete('Say hello', {
      config: {
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-5-sonnet-20241022',
        enabled: true,
      },
      apiKey: 'sk-ant-mock-key',
      recordUsage: false,
    });

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedApiKey).toBe('sk-ant-mock-key');
    expect(capturedVersion).toBe('2023-06-01');
    expect(result.text).toBe('Hello from Claude model!');
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 6, totalTokens: 18 });
  });

  it('never leaks API keys in error payloads or messages on HTTP failure', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response('Unauthorized: bad key sk-ant-secret-must-not-leak', { status: 401 }),
      );
    }) as unknown as typeof fetch;

    let caughtError: unknown;
    try {
      await complete('Say hello', {
        config: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: true,
        },
        apiKey: 'sk-ant-secret-must-not-leak',
        recordUsage: false,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AiClientError);
    const json = JSON.stringify(caughtError);
    expect(json).not.toContain('sk-ant-secret-must-not-leak');
  });

  it('rejects when provider is not configured and no direct config provided', async () => {
    await expect(complete('Say hello', {})).rejects.toThrow(AiDisabledError);
  });
});
