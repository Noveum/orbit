import { afterEach, describe, expect, it, type Mock, mock } from 'bun:test';
import { z } from 'zod';
import { ApiError, apiFetch, messageOf } from './fetcher.ts';

const schema = z.object({ ok: z.boolean() });
const realFetch = globalThis.fetch;

function respondWith(status: number, body: unknown): void {
  globalThis.fetch = mock(async () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('apiFetch', () => {
  it('returns parsed data on success', async () => {
    respondWith(200, { ok: true });
    await expect(apiFetch('/api/thing', schema)).resolves.toEqual({ ok: true });
  });

  it('throws a typed ApiError carrying the domain code', async () => {
    respondWith(403, { error: { code: 'forbidden', message: 'Nope.' } });
    const error = await apiFetch('/api/thing', schema).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'forbidden', message: 'Nope.' });
    expect((error as ApiError).is('forbidden')).toBe(true);
  });

  it('throws when the payload does not match the contract', async () => {
    respondWith(200, { ok: 'yes' });
    const error = await apiFetch('/api/thing', schema).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('internal');
  });

  it('sends a JSON body for writes', async () => {
    respondWith(200, { ok: true });
    await apiFetch('/api/thing', schema, { method: 'POST', body: { title: 'Hi' } });
    const fetchMock = globalThis.fetch as unknown as Mock<typeof fetch>;
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ title: 'Hi' }),
    });
  });
});

describe('messageOf', () => {
  it('prefers the api message, then the error message, then the fallback', () => {
    expect(messageOf(new ApiError(409, 'conflict', 'Taken.'))).toBe('Taken.');
    expect(messageOf(new Error('Boom'))).toBe('Boom');
    expect(messageOf(null, 'Fallback')).toBe('Fallback');
  });
});
