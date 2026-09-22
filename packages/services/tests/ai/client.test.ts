import { afterEach, describe, expect, it } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
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

  it('redacts API keys before slicing long error response strings', async () => {
    const secretKey = 'sk-long-secret-key-that-spans-char-240-to-290-boundary';
    const padding = 'a'.repeat(240);
    const responseBody = `${padding}${secretKey} extra text following secret key`;

    globalThis.fetch = (() => {
      return Promise.resolve(new Response(responseBody, { status: 400 }));
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
        apiKey: secretKey,
        recordUsage: false,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(AiClientError);
    const message = (caughtError as AiClientError).message;
    expect(message).not.toContain(secretKey);
    expect(message).not.toContain('sk-long-secret');
    expect(message).toContain('[REDACTED]');
  });

  it('rejects when provider is not configured and no direct config provided', async () => {
    await expect(complete('Say hello', {})).rejects.toThrow(AiDisabledError);
  });

  it('rejects direct configuration when enabled is false without calling fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;

    await expect(
      complete('Say hello', {
        config: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: false,
        },
        apiKey: 'sk-mock-key',
        recordUsage: false,
      }),
    ).rejects.toThrow(AiDisabledError);

    expect(fetchCalled).toBe(false);
  });

  it('rejects malformed OpenAI HTTP 200 response payload', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ choices: 'not-an-array' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    await expect(
      complete('Say hello', {
        config: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        recordUsage: false,
      }),
    ).rejects.toThrow(AiClientError);
  });

  it('rejects malformed Anthropic HTTP 200 response payload', async () => {
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ content: 'not-an-array' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    await expect(
      complete('Say hello', {
        config: {
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-3-5-sonnet-20241022',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        recordUsage: false,
      }),
    ).rejects.toThrow(AiClientError);
  });

  it('rejects oversized chunked OpenAI response and cancels stream', async () => {
    let canceled = false;
    const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024));
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    });

    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    await expect(
      complete('Say hello', {
        config: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        recordUsage: false,
      }),
    ).rejects.toThrow(AiClientError);

    expect(canceled).toBe(true);
  });

  it('rejects oversized chunked Anthropic response and cancels stream', async () => {
    let canceled = false;
    const chunk = new TextEncoder().encode('x'.repeat(1024 * 1024));
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    });

    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    await expect(
      complete('Say hello', {
        config: {
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-3-5-sonnet-20241022',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        recordUsage: false,
      }),
    ).rejects.toThrow(AiClientError);

    expect(canceled).toBe(true);
  });

  it('rejects connection when hostname resolves to loopback or private address', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    const mockLookup = (
      _h: string,
      _o: unknown,
      cb: (
        err: Error | null,
        addrs: readonly { address: string; family: number }[],
        family: number,
      ) => void,
    ) => {
      cb(null, [{ address: '127.0.0.1', family: 4 }], 4);
    };

    await expect(
      complete('Say hello', {
        config: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        dnsLookup: mockLookup as never,
        recordUsage: false,
      }),
    ).rejects.toThrow(AiClientError);
  });

  it('rejects connection when DNS changes to private destination between validation and connection', async () => {
    delete process.env['ALLOW_PRIVATE_AI_ENDPOINTS'];

    let calls = 0;
    const rebindingLookup = (
      _h: string,
      _o: unknown,
      cb: (
        err: Error | null,
        addrs: readonly { address: string; family: number }[],
        family: number,
      ) => void,
    ) => {
      calls += 1;
      const address = calls === 1 ? '93.184.216.34' : '169.254.169.254';
      cb(null, [{ address, family: 4 }], 4);
    };

    await new Promise<void>((resolve) => {
      rebindingLookup('api.openai.com', {}, () => resolve());
    });

    await expect(
      complete('Say hello', {
        config: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        dnsLookup: rebindingLookup as never,
        recordUsage: false,
      }),
    ).rejects.toThrow(AiClientError);
  });

  it('completes prompt against real HTTP server returning gzip-compressed response', async () => {
    process.env['ALLOW_PRIVATE_AI_ENDPOINTS'] = 'true';

    const payload = JSON.stringify({
      choices: [{ message: { content: 'Decompressed message!' } }],
      usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
    });
    const gzipped = zlib.gzipSync(Buffer.from(payload));

    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': String(gzipped.length),
      });
      res.end(gzipped);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    try {
      const result = await complete('Hello gzip', {
        config: {
          kind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'gpt-4o',
          enabled: true,
        },
        apiKey: 'sk-mock-key',
        recordUsage: false,
        allowPrivate: true,
      });
      expect(result.text).toBe('Decompressed message!');
      expect(result.usage).toEqual({ promptTokens: 15, completionTokens: 8, totalTokens: 23 });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
