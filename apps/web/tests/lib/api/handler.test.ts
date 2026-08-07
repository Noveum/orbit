import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { forbidden } from '@orbit/shared/errors';
import { ORIGIN_CLIENT_ID_HEADER, type SyncAction } from '@orbit/shared/events';

const published: SyncAction[][] = [];
const publishOutcome: { fail: boolean } = { fail: false };

const publishDeltas = mock((actions: readonly SyncAction[]) => {
  published.push([...actions]);
  return publishOutcome.fail
    ? Promise.reject(new Error('Redis is down.'))
    : Promise.resolve(undefined);
});

const core = await import('@orbit/core');
mock.module('@orbit/core', () => ({ ...core, publishDeltas }));

const requestHeaders = new Headers();
mock.module('next/headers', () => ({ headers: () => Promise.resolve(requestHeaders) }));

const { cachedJson, errorResponse, publish, readJson } = await import(
  '../../../src/lib/api/handler.ts'
);

function action(overrides: Partial<SyncAction> = {}): SyncAction {
  return {
    syncId: 1,
    organizationId: 'org_1',
    scopes: ['team:team_eng'],
    action: 'update',
    model: 'issue',
    modelId: 'issue_1',
    data: { id: 'issue_1' },
    actor: { type: 'user', id: 'user_1' },
    at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  published.length = 0;
  publishOutcome.fail = false;
  requestHeaders.delete(ORIGIN_CLIENT_ID_HEADER);
});

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

describe('errorResponse', () => {
  it('answers a domain error with its own code, status and message', async () => {
    const response = errorResponse(forbidden('You cannot comment on this doc.'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'forbidden', message: 'You cannot comment on this doc.' },
    });
  });

  it('never echoes a failed query or its parameters back to the caller', async () => {
    const response = errorResponse(
      new Error(
        'Failed query: insert into "doc_comment" ("body") values ($1)\nparams: Bob gets a raise.',
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain('doc_comment');
    expect(body).not.toContain('Bob gets a raise.');
    expect(JSON.parse(body)).toEqual({
      error: { code: 'internal', message: 'Something went wrong on our side.' },
    });
  });
});

describe('publish stamps the writing tab so its own echo can be suppressed', () => {
  it('carries the origin client id onto every action when the header is present', async () => {
    requestHeaders.set(ORIGIN_CLIENT_ID_HEADER, 'tab-a1b2c3');

    await publish([action(), action({ modelId: 'issue_2', model: 'comment' })]);

    const sent = published[0] ?? [];
    expect(sent).toHaveLength(2);
    expect(sent.map((entry) => entry.originClientId)).toEqual(['tab-a1b2c3', 'tab-a1b2c3']);
    expect(sent.map((entry) => entry.modelId)).toEqual(['issue_1', 'issue_2']);
  });

  it('leaves the actions unstamped when no tab identified itself', async () => {
    await publish([action()]);

    const sent = published[0] ?? [];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.originClientId).toBeUndefined();
  });

  it('ignores a header value the contract rejects rather than stamping garbage', async () => {
    requestHeaders.set(ORIGIN_CLIENT_ID_HEADER, '');

    await publish([action()]);

    expect(published[0]?.[0]?.originClientId).toBeUndefined();
  });

  it('never mutates the actions the caller handed it', async () => {
    requestHeaders.set(ORIGIN_CLIENT_ID_HEADER, 'tab-zz');
    const original = action();

    await publish([original]);

    expect(original.originClientId).toBeUndefined();
  });

  it('publishes nothing at all when there is nothing to publish', async () => {
    await publish([]);
    expect(published).toHaveLength(0);
  });

  it('never fails the request when the delta bus is unreachable', async () => {
    publishOutcome.fail = true;

    await expect(publish([action()])).resolves.toBeUndefined();
    expect(published).toHaveLength(1);
  });
});

describe('reading a request body', () => {
  function requestThatFailsToRead(): Request {
    const request = new Request('http://localhost/api/labels/lbl_1', { method: 'PATCH' });
    Object.defineProperty(request, 'text', {
      value: () => Promise.reject(new Error('connection reset while reading the body')),
    });
    return request;
  }

  it('reads a body the client actually sent', async () => {
    const request = new Request('http://localhost/api/labels/lbl_1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Urgent' }),
    });

    expect(await readJson(request)).toEqual({ name: 'Urgent' });
  });

  it('still treats a deliberately empty body as no fields, which archive and subscribe send', async () => {
    const request = new Request('http://localhost/api/issues/iss_1/subscribe', { method: 'POST' });

    expect(await readJson(request)).toEqual({});
  });

  it('refuses a body it could not read rather than reporting an unchanged record', async () => {
    await expect(readJson(requestThatFailsToRead())).rejects.toThrow(
      'That request body could not be read.',
    );
  });

  it('rejects a body that is not JSON', async () => {
    const request = new Request('http://localhost/api/labels/lbl_1', {
      method: 'PATCH',
      body: 'not json at all',
    });

    await expect(readJson(request)).rejects.toThrow('not valid JSON');
  });
});
