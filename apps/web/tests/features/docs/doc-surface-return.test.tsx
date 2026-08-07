import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderMarkdownWithHeadingIds } from '@orbit/services/markdown';
import { docFavoriteSchema } from '@orbit/shared/validators';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import type { WorkspaceData } from '@/features/issues/workspace-provider.tsx';
import * as workspaceProvider from '@/features/issues/workspace-provider.tsx';
import { createQueryClient } from '@/lib/query/provider.tsx';

mock.module('@orbit/realtime-client/react', () => ({
  useScopeSubscription: () => undefined,
  useDeltaHandler: () => undefined,
}));

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: mock(), replace: mock(), refresh: mock() }),
  usePathname: () => '/docs/doc_1',
  useParams: () => ({ id: 'doc_1' }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: () => undefined }),
}));

const workspace = {
  ready: true,
  userId: 'user_reader',
  teams: [],
  states: [],
  labels: [],
  members: [],
  projects: [],
  cycles: [],
  seedIssues: [],
  stateById: new Map(),
  labelById: new Map(),
  memberById: new Map(),
  openQuickCreate: () => undefined,
} as unknown as WorkspaceData;

mock.module('@/features/issues/workspace-provider.tsx', () => ({
  ...workspaceProvider,
  useWorkspace: () => workspace,
}));

const { DocSurface } = await import('../../../src/features/docs/doc-surface.tsx');

const MARKDOWN = '# Delta protocol\n\nEvery mutation bumps sync_id.';

interface RequestLog {
  readonly method: string;
  readonly url: string;
  readonly body: string | null;
}

let requests: RequestLog[] = [];
let heldFavorites: Array<() => void> = [];
let holdFavorites = false;
const realFetch = globalThis.fetch;

function docPayload(favorite: boolean) {
  return {
    doc: {
      id: 'doc_1',
      organizationId: 'org_1',
      collectionId: null,
      projectId: null,
      parentId: null,
      title: 'Delta protocol',
      slug: 'delta-protocol',
      content: MARKDOWN,
      sortOrder: 0,
      visibility: 'workspace',
      publishToken: null,
      authorId: 'user_author',
      repoBinding: null,
      syncId: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      archivedAt: null,
    },
    contentHtml: renderMarkdownWithHeadingIds(MARKDOWN),
    attachments: [],
    author: { id: 'user_author', name: 'Ada', image: null },
    followers: 1,
    backlinks: [],
    access: 'read',
    favorite,
  };
}

function stubFetch(favorite: boolean): void {
  globalThis.fetch = mock((input: string, init?: { method?: string; body?: string }) => {
    const url = String(input);
    requests.push({
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? init.body : null,
    });

    const answered = (payload: unknown) => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
    const body = (payload: unknown) => Promise.resolve(answered(payload));

    if (url.endsWith('/visit')) return body({ docId: 'doc_1' });
    if (url.endsWith('/favorite')) {
      const asked = docFavoriteSchema.parse(JSON.parse(init?.body ?? '{}'));
      const payload = { docId: 'doc_1', favorite: asked.favorite };
      if (!holdFavorites) return body(payload);
      return new Promise((resolve) => heldFavorites.push(() => resolve(answered(payload))));
    }
    if (url.startsWith('/api/docs/doc_1')) return body(docPayload(favorite));
    if (url.startsWith('/api/docs')) return body({ docs: [], collections: [], projects: [] });
    if (url.startsWith('/api/comments')) return body({ comments: [] });
    return body({});
  }) as unknown as typeof fetch;
}

async function renderSurface(favorite = false) {
  stubFetch(favorite);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <DocSurface docId="doc_1" canWriteDocs canPublish={false} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('doc-overflow');
}

beforeEach(() => {
  requests = [];
  heldFavorites = [];
  holdFavorites = false;
});

function favoriteBodies(): Array<string | null> {
  return requests.filter((entry) => entry.url.endsWith('/favorite')).map((entry) => entry.body);
}

async function release(index: number): Promise<void> {
  const gate = heldFavorites[index];
  if (gate === undefined) throw new Error(`favorite write ${index} has not been sent`);
  await act(async () => {
    gate();
    await Promise.resolve();
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('opening a doc', () => {
  it('records the visit so the docs home can offer it back', async () => {
    await renderSurface();

    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'POST',
        url: '/api/docs/doc_1/visit',
        body: '{}',
      }),
    );
  });

  it('records the visit once, not on every render', async () => {
    await renderSurface();

    await waitFor(() =>
      expect(requests.filter((entry) => entry.url.endsWith('/visit'))).toHaveLength(1),
    );
    expect(requests.filter((entry) => entry.url.endsWith('/visit'))).toHaveLength(1);
  });
});

describe('starring a doc', () => {
  it('offers a star to a reader and sends the new state', async () => {
    const user = userEvent.setup();
    await renderSurface(false);

    const star = await screen.findByTestId('doc-favorite');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.getAttribute('aria-label')).toBe('Star Delta protocol');

    await user.click(star);

    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'POST',
        url: '/api/docs/doc_1/favorite',
        body: '{"favorite":true}',
      }),
    );
  });

  it('still takes a click while the previous write is in flight, and sends them in that order', async () => {
    const user = userEvent.setup();
    holdFavorites = true;
    await renderSurface(false);

    const star = await screen.findByTestId('doc-favorite');
    await user.click(star);
    await waitFor(() => expect(heldFavorites).toHaveLength(1));

    expect(star.hasAttribute('disabled')).toBe(false);
    await user.click(star);
    expect(favoriteBodies()).toEqual(['{"favorite":true}']);

    await release(0);
    await waitFor(() => expect(heldFavorites).toHaveLength(2));
    await release(1);

    await waitFor(() =>
      expect(favoriteBodies()).toEqual(['{"favorite":true}', '{"favorite":false}']),
    );
    expect(star.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows an already starred doc as pressed and offers to unstar it', async () => {
    const user = userEvent.setup();
    await renderSurface(true);

    const star = await screen.findByTestId('doc-favorite');
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.getAttribute('aria-label')).toBe('Unstar Delta protocol');

    await user.click(star);

    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'POST',
        url: '/api/docs/doc_1/favorite',
        body: '{"favorite":false}',
      }),
    );
  });
});
