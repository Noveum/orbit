import { afterEach, describe, expect, it, mock } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DocsHome as DocsHomePayload } from '@/lib/query/schemas.ts';

const originalFetch = globalThis.fetch;

const { DocsHome } = await import('@/features/docs/docs-home.tsx');

function entry(id: string, title: string, updatedAt = '2026-01-01T00:00:00.000Z') {
  return { id, title, collectionId: null, projectId: null, authorId: 'user_1', updatedAt };
}

function stubHome(payload: DocsHomePayload): string[] {
  const urls: string[] = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return urls;
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderHome() {
  const Wrapper = wrapper();
  render(
    <Wrapper>
      <DocsHome />
    </Wrapper>,
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe('the docs home pane', () => {
  it('shows recently viewed, favourites and what changed, each linking to its doc', async () => {
    stubHome({
      recent: [entry('doc_recent', 'Deploy runbook')],
      favorites: [entry('doc_star', 'Team handbook')],
      updated: [entry('doc_new', 'Postmortem')],
    });
    renderHome();

    const recent = await screen.findByTestId('docs-home-recent-doc_recent');
    expect(recent.getAttribute('href')).toBe('/docs/doc_recent');
    expect(recent.textContent).toContain('Deploy runbook');

    expect(screen.getByTestId('docs-home-favorites-doc_star').getAttribute('href')).toBe(
      '/docs/doc_star',
    );
    expect(screen.getByTestId('docs-home-updated-doc_new').getAttribute('href')).toBe(
      '/docs/doc_new',
    );
  });

  it('reads the home endpoint rather than the doc list', async () => {
    const urls = stubHome({ recent: [], favorites: [], updated: [] });
    renderHome();

    await waitFor(() => expect(urls.length).toBe(1));
    expect(new URL(urls[0] ?? '', 'http://localhost').pathname).toBe('/api/docs/home');
  });

  it('tells a first time reader what each shelf is for instead of showing a blank pane', async () => {
    stubHome({ recent: [], favorites: [], updated: [] });
    renderHome();

    const recent = await screen.findByTestId('docs-home-recent');
    expect(recent.textContent).toContain('Docs you open show up here.');
    expect(screen.getByTestId('docs-home-favorites').textContent).toContain('Star a doc');
  });

  it('keeps a doc listed under the shelf it came back on', async () => {
    stubHome({
      recent: [entry('doc_a', 'Runbook')],
      favorites: [],
      updated: [entry('doc_b', 'Postmortem')],
    });
    renderHome();

    await screen.findByTestId('docs-home-recent-doc_a');
    expect(screen.getByTestId('docs-home-recent').textContent).not.toContain('Postmortem');
    expect(screen.getByTestId('docs-home-updated').textContent).not.toContain('Runbook');
  });
});
