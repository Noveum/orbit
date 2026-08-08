import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DOC_SEARCH_RESULT_LIMIT, useDocSearch } from '../../../src/lib/query/use-doc-search.ts';

const originalFetch = globalThis.fetch;

const hit = {
  id: 'doc_1',
  organizationId: 'org_1',
  collectionId: null,
  projectId: null,
  parentId: null,
  title: 'Deploy runbook',
  slug: 'deploy-runbook',
  content: '',
  sortOrder: 0,
  visibility: 'workspace',
  publishToken: null,
  authorId: 'user_1',
  repoBinding: null,
  syncId: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  archivedAt: null,
  excerpt: '',
  snippet: 'a quorum of two',
  titleMatch: false,
  rank: 0,
};

function stubFetch(docs: readonly unknown[] = [hit]): string[] {
  const urls: string[] = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ docs, collections: [], projects: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return urls;
}

function stubFetchPerTerm(byTerm: Readonly<Record<string, string>>): void {
  globalThis.fetch = mock((input: string | URL | Request) => {
    const asked = new URL(String(input), 'http://localhost').searchParams.get('query') ?? '';
    const id = byTerm[asked];
    const docs = id === undefined ? [] : [{ ...hit, id }];
    return new Response(JSON.stringify({ docs, collections: [], projects: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('useDocSearch', () => {
  it('asks the docs endpoint for a handful of hits for the typed term', async () => {
    const urls = stubFetch();
    renderHook(() => useDocSearch('quorum handshake'), { wrapper: wrapper(newClient()) });

    await waitFor(() => expect(urls.length).toBe(1));

    const asked = new URL(urls[0] ?? '', 'http://localhost');
    expect(asked.pathname).toBe('/api/docs');
    expect(asked.searchParams.get('query')).toBe('quorum handshake');
    expect(asked.searchParams.get('limit')).toBe(String(DOC_SEARCH_RESULT_LIMIT));
  });

  it('stays quiet until the term is long enough to be worth a round trip', async () => {
    const urls = stubFetch();
    const view = renderHook(({ term }) => useDocSearch(term), {
      wrapper: wrapper(newClient()),
      initialProps: { term: 'q' },
    });

    await waitFor(() => expect(view.result.current.searching).toBe(false));
    expect(urls).toEqual([]);

    view.rerender({ term: 'quorum' });
    await waitFor(() => expect(urls.length).toBe(1));
  });

  it('stops offering the earlier term hits the moment the typed term moves on', async () => {
    stubFetchPerTerm({ quorum: 'doc_quorum', handshake: 'doc_handshake' });
    const view = renderHook(({ term }) => useDocSearch(term), {
      wrapper: wrapper(newClient()),
      initialProps: { term: 'quorum' },
    });

    await waitFor(() =>
      expect(view.result.current.docs.map((doc) => doc.id)).toEqual(['doc_quorum']),
    );

    view.rerender({ term: 'handshake' });

    expect(view.result.current.docs).toEqual([]);
    expect(view.result.current.searching).toBe(true);

    await waitFor(() =>
      expect(view.result.current.docs.map((doc) => doc.id)).toEqual(['doc_handshake']),
    );
  });

  it('withholds an already cached answer that belongs to a term nobody is looking at', async () => {
    stubFetchPerTerm({ quorum: 'doc_quorum', handshake: 'doc_handshake' });
    const client = newClient();
    const view = renderHook(({ term }) => useDocSearch(term), {
      wrapper: wrapper(client),
      initialProps: { term: 'quorum' },
    });

    await waitFor(() =>
      expect(view.result.current.docs.map((doc) => doc.id)).toEqual(['doc_quorum']),
    );
    view.rerender({ term: 'handshake' });
    await waitFor(() =>
      expect(view.result.current.docs.map((doc) => doc.id)).toEqual(['doc_handshake']),
    );

    view.rerender({ term: 'quorum' });

    expect(view.result.current.docs).toEqual([]);
  });

  it('reports nothing at all once the term drops back below the threshold', async () => {
    stubFetch();
    const view = renderHook(({ term }) => useDocSearch(term), {
      wrapper: wrapper(newClient()),
      initialProps: { term: 'quorum' },
    });

    await waitFor(() => expect(view.result.current.docs.map((doc) => doc.id)).toEqual(['doc_1']));

    view.rerender({ term: 'q' });

    await waitFor(() => expect(view.result.current.docs).toEqual([]));
  });
});
