import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { safeFetch } from '../../src/ai/transport.ts';

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function runAs(userAgent: string): void {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
}

afterEach(() => {
  if (navigatorDescriptor === undefined) Reflect.deleteProperty(globalThis, 'navigator');
  else Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
});

describe('safeFetch on the Workers runtime', () => {
  it('sends the request through fetch without following redirects', async () => {
    runAs('Cloudflare-Workers');
    const upstream = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: true }, { status: 201 }),
    );
    try {
      const response = await safeFetch('https://api.openai.com/v1/chat', {
        method: 'POST',
        headers: { authorization: 'Bearer key' },
        body: '{"prompt":"hi"}',
      });
      expect(response.status).toBe(201);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(upstream.mock.calls[0]).toEqual([
        'https://api.openai.com/v1/chat',
        {
          redirect: 'manual',
          method: 'POST',
          headers: { authorization: 'Bearer key' },
          body: '{"prompt":"hi"}',
        },
      ]);
    } finally {
      upstream.mockRestore();
    }
  });

  it('still refuses a literal private destination before any request', async () => {
    runAs('Cloudflare-Workers');
    const upstream = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    try {
      await expect(safeFetch('http://127.0.0.1', { allowPrivate: false })).rejects.toThrow(
        'Blocked connection to private destination',
      );
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      upstream.mockRestore();
    }
  });

  it('requires a verified transport for a custom provider unless explicitly allowed', async () => {
    runAs('Cloudflare-Workers');
    const upstream = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));
    try {
      const url = 'https://custom-provider.example/v1/chat';
      await expect(safeFetch(url, { allowPrivate: false })).rejects.toThrow('validates DNS');
      expect(upstream).not.toHaveBeenCalled();
      expect((await safeFetch(url, { allowPrivate: true })).ok).toBe(true);
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      upstream.mockRestore();
    }
  });

  it('keeps the pinned socket transport on every other runtime', async () => {
    runAs('Node.js/24');
    const upstream = spyOn(globalThis, 'fetch');
    try {
      await expect(
        safeFetch('https://api.provider.example/v1/chat', {
          dnsLookup: (_host, _options, callback) => {
            callback(new Error('lookup reached'), '', 4);
          },
        }),
      ).rejects.toThrow('lookup reached');
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      upstream.mockRestore();
    }
  });
});
