import { describe, expect, it, mock } from 'bun:test';

const publishDeltas = mock(() => Promise.reject(new Error('Redis is down.')));

const core = await import('@orbit/core');
mock.module('@orbit/core', () => ({ ...core, publishDeltas }));
mock.module('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const { cachedJson, publish } = await import('./handler.ts');

const ACTION = {
  syncId: 1,
  organizationId: 'org_1',
  scopes: ['team:team_eng'],
  action: 'update' as const,
  model: 'issue' as const,
  modelId: 'issue_1',
  data: { id: 'issue_1' },
  actor: { type: 'user' as const, id: 'user_1' },
  at: '2026-01-01T00:00:00.000Z',
};

describe('cachedJson', () => {
  it('serves the payload with a weak etag the client can revalidate against', async () => {
    const response = await cachedJson(new Request('http://localhost/api/bootstrap'), 'v1', () =>
      Promise.resolve({ ok: true }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('W/"v1"');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers a matching if-none-match with 304 and never builds the payload', async () => {
    let built = 0;
    const request = new Request('http://localhost/api/bootstrap', {
      headers: { 'if-none-match': 'W/"v1"' },
    });

    const response = await cachedJson(request, 'v1', () => {
      built += 1;
      return Promise.resolve({ ok: true });
    });

    expect(response.status).toBe(304);
    expect(built).toBe(0);
  });

  it('rebuilds when the version moved on', async () => {
    const request = new Request('http://localhost/api/bootstrap', {
      headers: { 'if-none-match': 'W/"v1"' },
    });

    const response = await cachedJson(request, 'v2', () => Promise.resolve({ ok: true }));
    expect(response.status).toBe(200);
  });
});

describe('publish', () => {
  it('never fails the request when the delta bus is unreachable', async () => {
    await expect(publish([ACTION])).resolves.toBeUndefined();
    expect(publishDeltas).toHaveBeenCalled();
  });
});
